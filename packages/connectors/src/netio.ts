import { ConnectorError, sample, type Connector } from "./types.js";
import { validateTarget } from "./scope.js";

/** NETIO Smart PDU JSON M2M API. */
export const netioConnector: Connector = {
  id: "netio-pdu",
  async read(target, context) {
    validateTarget(target, context);
    const timeout = context.timeoutMs ?? 3000;
    const url = `http://${target.address}:${target.port ?? 80}/netio.json`;
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (context.credential) {
      headers["Authorization"] = context.credential.startsWith("Basic ") ? context.credential : `Basic ${Buffer.from(context.credential).toString("base64")}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectorError("authentication", "NETIO PDU authentication failed", "reachable");
      }
      if (!response.ok) {
        throw new ConnectorError("transport", `NETIO HTTP error ${response.status}`, "reachable");
      }
      const data = await response.json() as Record<string, any>;
      const agent = data?.Agent ?? {};
      const global = data?.GlobalMeasure ?? {};
      const outputs = Array.isArray(data?.Outputs) ? data.Outputs : [];
      const voltage = typeof global.Voltage === "number" ? global.Voltage : null;
      const totalPower = typeof global.TotalPower === "number" ? global.TotalPower : null;
      const health = voltage !== null && voltage >= 85 && voltage <= 265 ? "healthy" : "unknown";
      return sample(target, {
        reachability: "reachable", health, auth: context.credential ? "ok" : "unknown",
        metrics: {
          model: agent.Model ?? "NETIO PDU",
          firmware: agent.Version ?? null,
          voltage,
          totalPowerWatts: totalPower,
          outputCount: outputs.length,
          protocol: "netio-json"
        }
      });
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      if (err && typeof err === "object" && (err as any).name === "AbortError") {
        throw new ConnectorError("transport", "NETIO PDU response timeout", "unknown");
      }
      throw new ConnectorError("transport", "NETIO PDU connection failed", "unreachable");
    } finally {
      clearTimeout(timer);
    }
  },
};
