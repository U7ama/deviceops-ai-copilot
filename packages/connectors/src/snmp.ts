import { createRequire } from "node:module";
import { ConnectorError, sample, type Connector, type ConnectorContext, type EnrolledTarget } from "./types.js";
import { validateTarget } from "./scope.js";
interface Varbind { oid: string; type: number; value?: unknown }
interface SnmpSession { get(oids: string[], cb: (error: Error | null, values: Varbind[]) => void): void; close(): void }
interface SnmpLibrary {
  Version2c: number; createSession(host: string, community: string, options: Record<string, unknown>): SnmpSession;
  isVarbindError(value: Varbind): boolean;
}
const snmp = createRequire(import.meta.url)("net-snmp") as SnmpLibrary;
export const systemOids = { description: "1.3.6.1.2.1.1.1.0", uptimeTicks: "1.3.6.1.2.1.1.3.0", name: "1.3.6.1.2.1.1.5.0" };
export async function readSnmpOids(target: EnrolledTarget, context: ConnectorContext, oids: string[]): Promise<Record<string, string | number | null>> {
  validateTarget(target, context);
  if (!context.credential) throw new ConnectorError("authentication", "A vault community reference is required");
  if (oids.length < 1 || oids.length > 96 || oids.some((oid) => !/^1(?:\.\d+){3,20}$/.test(oid))) throw new Error("Invalid or unbounded SNMP request");
  const timeout = context.timeoutMs ?? 3000;
  const session = snmp.createSession(target.address, context.credential, { version: snmp.Version2c, port: target.port ?? 161, retries: 0, timeout, transport: "udp4" });
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: ConnectorError, result?: Record<string, string | number | null>) => {
      if (finished) return; finished = true; clearTimeout(timer); session.close();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new ConnectorError("transport", "SNMP response timeout")), timeout + 100);
    session.get(oids, (error, values) => {
      // v2c commonly drops bad-community requests. Timeout cannot establish credential failure or device offline.
      if (error) { finish(new ConnectorError(/authorizationError|noAccess/i.test(error.message) ? "authentication" : "transport", "SNMP request failed")); return; }
      const result: Record<string, string | number | null> = {};
      for (const value of values) {
        if (!oids.includes(value.oid)) continue;
        result[value.oid] = snmp.isVarbindError(value) ? null : Buffer.isBuffer(value.value) ? value.value.toString("utf8").slice(0, 1024) : typeof value.value === "number" ? value.value : String(value.value ?? "").slice(0, 1024);
      }
      finish(undefined, result);
    });
  });
}
export const snmpConnector: Connector = {
  id: "snmp-v2c", async read(target, context) {
    const values = await readSnmpOids(target, context, Object.values(systemOids));
    return sample(target, { reachability: "reachable", health: "unknown", auth: "ok", metrics: {
      description: values[systemOids.description] ?? null, uptimeTicks: values[systemOids.uptimeTicks] ?? null, name: values[systemOids.name] ?? null,
      unsupportedOids: Object.keys(values).filter((oid) => values[oid] === null), protocol: "snmp-v2c",
    } });
  },
};
export const snmpSwitchConnector: Connector = {
  id: "snmp-switch-ports", async read(target, context) {
    const indexes = target.interfaceIndexes ?? [];
    if (!indexes.length || indexes.length > 32 || indexes.some((index) => !Number.isInteger(index) || index < 1 || index > 2147483647) || new Set(indexes).size !== indexes.length) throw new ConnectorError("unsupported", "Configure 1 to 32 unique IF-MIB interface indexes");
    const oid = (column: number, index: number) => `1.3.6.1.2.1.2.2.1.${column}.${index}`;
    const values = await readSnmpOids(target, context, indexes.flatMap((index) => [oid(2, index), oid(7, index), oid(8, index)]));
    const ports = indexes.map((index) => ({ index, description: values[oid(2, index)] ?? null, adminStatus: values[oid(7, index)] ?? null, operStatus: values[oid(8, index)] ?? null }));
    const degraded = ports.some((port) => port.adminStatus === 1 && port.operStatus === 2);
    const unknown = ports.some((port) => port.adminStatus === null || port.operStatus === null);
    return sample(target, { reachability: "reachable", health: degraded ? "warning" : unknown ? "unknown" : "healthy", auth: "ok", metrics: { ports, protocol: "snmp-v2c" } });
  },
};
