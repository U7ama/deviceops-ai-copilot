import { ConnectorError, sample, type Connector } from "./types.js";
import { validateTarget } from "./scope.js";

/** Barco ClickShare Base Unit REST API v2. */
export const barcoConnector: Connector = {
  id: "barco-clickshare",
  async read(target, context) {
    validateTarget(target, context);
    const timeout = context.timeoutMs ?? 3000;
    const url = `http://${target.address}:${target.port ?? 80}/v2/system`;
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (context.credential) {
      headers["Authorization"] = context.credential.startsWith("Bearer ") ? context.credential : `Bearer ${context.credential}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectorError("authentication", "Barco ClickShare authentication failed", "reachable");
      }
      if (!response.ok) {
        throw new ConnectorError("transport", `Barco ClickShare HTTP error ${response.status}`, "reachable");
      }
      const data = await response.json() as Record<string, any>;
      const model = data?.model ?? data?.productName ?? "ClickShare";
      const serial = data?.serialNumber ?? null;
      const firmware = data?.firmwareVersion ?? null;
      const temp = typeof data?.temperature === "number" ? data.temperature : null;
      const status = typeof data?.status === "string" ? data.status : null;
      const health = status === "ok" ? "healthy" : status === "warning" ? "warning" : status ? "error" : "unknown";
      return sample(target, {
        reachability: "reachable", health, auth: context.credential ? "ok" : "unknown",
        metrics: {
          model, serialNumber: serial, firmwareVersion: firmware, temperatureC: temp, status,
          protocol: "barco-clickshare-v2"
        }
      });
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      if (err && typeof err === "object" && (err as any).name === "AbortError") {
        throw new ConnectorError("transport", "Barco ClickShare response timeout", "unknown");
      }
      throw new ConnectorError("transport", "Barco ClickShare connection failed", "unreachable");
    } finally {
      clearTimeout(timer);
    }
  },
};
