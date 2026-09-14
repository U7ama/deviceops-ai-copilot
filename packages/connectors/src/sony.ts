import { ConnectorError, sample, type Connector } from "./types.js";
import { validateTarget } from "./scope.js";

/** Sony BRAVIA Professional Display B2B REST API. */
export const sonyConnector: Connector = {
  id: "sony-pro",
  async read(target, context) {
    validateTarget(target, context);
    const timeout = context.timeoutMs ?? 3000;
    const url = `http://${target.address}:${target.port ?? 80}/sony/system`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(context.credential ? { "X-Auth-PSK": context.credential } : {})
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const body = JSON.stringify({ method: "getPowerStatus", params: [], id: 1, version: "1.0" });
      const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectorError("authentication", "Sony PSK authentication rejected", "reachable");
      }
      if (!response.ok) {
        throw new ConnectorError("transport", `Sony REST HTTP error ${response.status}`, "reachable");
      }
      const data = await response.json() as Record<string, any>;
      if (data.error) {
        const code = Array.isArray(data.error) ? data.error[0] : 0;
        if (code === 401 || code === 403) throw new ConnectorError("authentication", "Sony PSK unauthorized", "reachable");
        throw new ConnectorError("protocol", "Sony JSON-RPC error", "reachable");
      }
      const powerStatus = data?.result?.[0]?.status ?? "unknown";
      const health = ["active", "standby"].includes(powerStatus) ? "healthy" : "unknown";
      return sample(target, {
        reachability: "reachable", health, auth: context.credential ? "ok" : "unknown",
        metrics: { powerStatus, protocol: "sony-bravia-rest" }
      });
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      if (err && typeof err === "object" && (err as any).name === "AbortError") {
        throw new ConnectorError("transport", "Sony BRAVIA response timeout", "unknown");
      }
      throw new ConnectorError("transport", "Sony BRAVIA connection failed", "unreachable");
    } finally {
      clearTimeout(timer);
    }
  },
};
