import { ConnectorError, sample, type Connector } from "./types.js";
import { validateTarget } from "./scope.js";

/** Axis VAPIX Basic Device Information HTTP API. */
export const axisConnector: Connector = {
  id: "axis-vapix",
  async read(target, context) {
    validateTarget(target, context);
    const timeout = context.timeoutMs ?? 3000;
    const url = `http://${target.address}:${target.port ?? 80}/axis-cgi/basicdeviceinfo.cgi`;
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (context.credential) {
      headers["Authorization"] = context.credential.startsWith("Basic ") ? context.credential : `Basic ${Buffer.from(context.credential).toString("base64")}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectorError("authentication", "Axis VAPIX authentication failed", "reachable");
      }
      if (!response.ok) {
        throw new ConnectorError("transport", `Axis VAPIX HTTP error ${response.status}`, "reachable");
      }
      const data = await response.json() as Record<string, any>;
      const dev = data?.DeviceInformation ?? data;
      const model = dev?.Model ?? dev?.ProdNbr ?? "Axis Camera";
      const serial = dev?.SerialNumber ?? null;
      const firmware = dev?.Version ?? null;
      const uptime = dev?.Uptime ? Number(dev.Uptime) : null;
      return sample(target, {
        reachability: "reachable", health: "unknown", auth: context.credential ? "ok" : "unknown",
        metrics: { model, serialNumber: serial, firmwareVersion: firmware, uptimeSeconds: uptime, protocol: "axis-vapix" }
      });
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      if (err && typeof err === "object" && (err as any).name === "AbortError") {
        throw new ConnectorError("transport", "Axis VAPIX response timeout", "unknown");
      }
      throw new ConnectorError("transport", "Axis VAPIX connection failed", "unreachable");
    } finally {
      clearTimeout(timer);
    }
  },
};
