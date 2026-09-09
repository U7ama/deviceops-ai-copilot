import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Socket } from "node:net";
import { createSocket, type Socket as DatagramSocket } from "node:dgram";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { CredentialVault, flattenMetrics, assertAllowedAddress, expandDiscoveryTargets, integrationCatalog, pingConnector, pjlinkConnector, queryPJLink, snmpConnector, snmpSwitchConnector, failedSample, type EnrolledTarget } from "./index.js";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const context = { allowedTargets: ["127.0.0.1/32"], timeoutMs: 1000 };
function target(connectorId: EnrolledTarget["connectorId"], port?: number): EnrolledTarget {
  return { deviceId: "fixture-device", address: "127.0.0.1", sourceMode: "simulated", connectorId, ...(port ? { port } : {}) };
}
async function tcpFixture(reply: (command: string) => string | null, password?: string): Promise<number> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => undefined);
    socket.write(password ? "PJLINK 1 1234abcd\r" : "PJLINK 0\r");
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString(); if (!buffer.endsWith("\r")) return;
      if (password) {
        const digest = createHash("md5").update("1234abcd" + password).digest("hex");
        if (!buffer.startsWith(digest)) { socket.end("PJLINK ERRA\r"); return; }
        buffer = buffer.slice(32);
      }
      const result = reply(buffer); if (result !== null) socket.write(result); buffer = "";
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanups.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return (server.address() as { port: number }).port;
}
interface FixtureMib { registerProvider(provider: object): void; setScalarValue(name: string, value: unknown): void; addTableRow(name: string, values: unknown[]): void }
interface FixtureAgent { getAuthorizer(): { addCommunity(value: string): void }; getMib(): FixtureMib; listener: { sockets: Record<string, DatagramSocket> }; close(callback: () => void): void }
interface FixtureLibrary { createAgent(options: object, callback: (error: unknown) => void): FixtureAgent; MibProviderType: { Scalar: number; Table: number }; ObjectType: { OctetString: number; Integer: number; TimeTicks: number }; MaxAccess: Record<string, number> }
async function snmpFixture(): Promise<number> {
  const snmp = createRequire(import.meta.url)("net-snmp") as FixtureLibrary;
  const reservation = createSocket("udp4"); reservation.bind(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const agent = snmp.createAgent({ port, address: "127.0.0.1", transport: "udp4", disableAuthorization: false }, () => undefined);
  agent.getAuthorizer().addCommunity("fixture-read-only");
  const mib = agent.getMib();
  for (const [name, oid, type, value] of [["sysDescr", "1.3.6.1.2.1.1.1", snmp.ObjectType.OctetString, "Fixture switch"], ["sysUpTime", "1.3.6.1.2.1.1.3", snmp.ObjectType.TimeTicks, 5000], ["sysName", "1.3.6.1.2.1.1.5", snmp.ObjectType.OctetString, "switch-a"]] as const) {
    mib.registerProvider({ name, type: snmp.MibProviderType.Scalar, oid, scalarType: type, maxAccess: snmp.MaxAccess["read-only"] }); mib.setScalarValue(name, value);
  }
  mib.registerProvider({ name: "ifTable", type: snmp.MibProviderType.Table, oid: "1.3.6.1.2.1.2.2.1", maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [[1, "ifIndex", snmp.ObjectType.Integer], [2, "ifDescr", snmp.ObjectType.OctetString], [7, "ifAdminStatus", snmp.ObjectType.Integer], [8, "ifOperStatus", snmp.ObjectType.Integer]].map(([number, name, type]) => ({ number, name, type, maxAccess: snmp.MaxAccess["read-only"] })), tableIndex: [{ columnName: "ifIndex" }] });
  mib.addTableRow("ifTable", [1, "uplink", 1, 1]); mib.addTableRow("ifTable", [2, "projector", 1, 2]);
  await Promise.all(Object.values(agent.listener.sockets).map((socket) => once(socket, "listening")));
  cleanups.push(() => new Promise<void>((resolve) => agent.close(resolve))); return port;
}
describe("connector catalog and scope", () => {
  it("retains all 57 entries with truthful implementation and category counts", () => {
    expect(integrationCatalog).toHaveLength(57); expect(new Set(integrationCatalog.map((item) => item.id)).size).toBe(57);
    expect(Object.fromEntries(["cloud", "on-lan", "server", "manufacturer-cloud"].map((category) => [category, integrationCatalog.filter((item) => item.category === category).length]))).toEqual({ cloud: 11, "on-lan": 39, server: 6, "manufacturer-cloud": 1 });
    expect(integrationCatalog.filter((item) => item.status === "planned")).toHaveLength(53);
    expect(integrationCatalog.some((item) => item.status === "hardware/service-verified")).toBe(false);
  });
  it("rejects shell inputs, DNS targets, out-of-scope addresses and broad subnets", () => {
    for (const address of ["127.0.0.1;id", "$(id)", "localhost", "127.0.0.2", "169.254.169.254"]) expect(() => assertAllowedAddress(address, context.allowedTargets)).toThrow();
    expect(() => expandDiscoveryTargets(["10.0.0.0/23"], ["10.0.0.0/23"])).toThrow(/24/);
    expect(expandDiscoveryTargets(["10.0.0.0/24"], ["10.0.0.0/24"])).toHaveLength(254);
    expect(expandDiscoveryTargets(["127.0.0.1", "127.0.0.1/32"], context.allowedTargets)).toEqual(["127.0.0.1"]);
  });
  it("emits only bounded scalar metrics compatible with the ingestion contract", () => {
    const metrics = flattenMetrics({ ports: [{ index: 2, operStatus: 1 }], description: "x".repeat(500), invalid: Number.NaN });
    expect(metrics).toEqual({ "ports.0.index": 2, "ports.0.operStatus": 1, description: "x".repeat(400), invalid: null });
    expect(Object.values(metrics).every((value) => value === null || ["string", "number", "boolean"].includes(typeof value))).toBe(true);
  });
  it("uses actual loopback ICMP without inferring application health", async () => {
    const result = await pingConnector.read(target("ping"), context);
    expect(result.reachability).toBe("reachable"); expect(result.health).toBe("unknown"); expect(result.metrics.latencyMs).toEqual(expect.any(Number));
  });
});
describe("PJLink TCP protocol", () => {
  it("reads authenticated status and preserves unsupported queries", async () => {
    const replies: Record<string, string> = { POWR: "1", ERST: "010000", LAMP: "ERR1", INPT: "31" };
    const port = await tcpFixture((command) => { const name = command.slice(2, 6); return `%1${name}=${replies[name]}\r`; }, "fixture-password");
    const result = await pjlinkConnector.read(target("pjlink", port), { ...context, credential: "fixture-password" });
    expect(result.health).toBe("warning"); expect(result.auth).toBe("ok"); expect(result.metrics["unsupportedQueries.0"]).toBe("LAMP");
  });
  it("distinguishes rejected passwords from offline state without exposing secrets", async () => {
    const port = await tcpFixture(() => null, "expected-secret");
    const device = target("pjlink", port);
    const error = await queryPJLink(device, { ...context, credential: "bad-secret" }, "POWR").catch((value: unknown) => value);
    expect(failedSample(device, error)).toMatchObject({ reachability: "reachable", auth: "failed", health: "unknown" });
    expect(JSON.stringify(failedSample(device, error))).not.toMatch(/bad-secret|expected-secret/);
  });
  it("bounds a server that never answers", async () => {
    const port = await tcpFixture(() => null), started = Date.now();
    await expect(queryPJLink(target("pjlink", port), { ...context, timeoutMs: 30 }, "POWR")).rejects.toMatchObject({ kind: "transport" });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
describe("SNMP UDP fixtures", () => {
  it("reads standard system fields and explicit IF-MIB ports over v2c", async () => {
    const port = await snmpFixture(), credential = "fixture-read-only";
    const result = await snmpConnector.read(target("snmp-v2c", port), { ...context, credential });
    expect(result.metrics).toMatchObject({ description: "Fixture switch", uptimeTicks: 5000, name: "switch-a" });
    expect(result.health).toBe("unknown");
    const ports = await snmpSwitchConnector.read({ ...target("snmp-switch-ports", port), interfaceIndexes: [1, 2] }, { ...context, credential });
    expect(ports.health).toBe("warning"); expect(ports.metrics).toMatchObject({ "ports.0.index": 1, "ports.0.description": "uplink", "ports.0.adminStatus": 1, "ports.0.operStatus": 1, "ports.1.index": 2, "ports.1.description": "projector", "ports.1.adminStatus": 1, "ports.1.operStatus": 2 });
  });
  it("does not assert credential failure or offline from a dropped v2c request", async () => {
    const port = await snmpFixture(), device = target("snmp-v2c", port);
    const error = await snmpConnector.read(device, { ...context, timeoutMs: 30, credential: "wrong-community" }).catch((value: unknown) => value);
    expect(failedSample(device, error)).toMatchObject({ reachability: "unknown", health: "unknown", auth: "unknown", metrics: { errorKind: "transport" } });
  });
});
describe("local credential vault", () => {
  it("encrypts, replaces, revokes and rejects tampering or a different key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deviceops-vault-")); cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const filename = join(directory, "credentials.json"), key = randomBytes(32).toString("base64"), vault = new CredentialVault(filename, key);
    await vault.set("snmp", "never-in-plaintext"); expect(await vault.get("snmp")).toBe("never-in-plaintext");
    expect(await readFile(filename, "utf8")).not.toContain("never-in-plaintext"); expect((await stat(filename)).mode & 0o777).toBe(0o600);
    await expect(new CredentialVault(filename, randomBytes(32).toString("base64")).get("snmp")).rejects.toThrow(/authentication/);
    await vault.set("snmp", "replacement"); expect(await vault.get("snmp")).toBe("replacement");
    await vault.revoke("snmp"); expect(await vault.get("snmp")).toBeUndefined(); expect(await vault.get("constructor")).toBeUndefined();
    const envelope = JSON.parse(await readFile(filename, "utf8")) as { tag: string }; envelope.tag = randomBytes(16).toString("base64");
    await writeFile(filename, JSON.stringify(envelope)); await expect(vault.get("snmp")).rejects.toThrow(/authentication/);
  });
});
