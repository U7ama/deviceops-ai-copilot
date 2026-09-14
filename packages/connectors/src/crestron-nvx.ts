import { ConnectorError, sample, type Connector } from "./types.js";
import { validateTarget } from "./scope.js";

/** Crestron DM NVX Streaming REST API. */
export const crestronNvxConnector: Connector = {
  id: "crestron-nvx-nax",
  async read(target, context) {
    validateTarget(target, context);
    const timeout = context.timeoutMs ?? 3000;
    const url = `http://${target.address}:${target.port ?? 80}/Device/DeviceInfo`;
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (context.credential) {
      headers["Authorization"] = context.credential.startsWith("Bearer ") ? context.credential : `Bearer ${context.credential}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectorError("authentication", "Crestron DM NVX authentication failed", "reachable");
      }
      if (!response.ok) {
        throw new ConnectorError("transport", `Crestron DM NVX HTTP error ${response.status}`, "reachable");
      }
      const data = await response.json() as Record<string, any>;
      const dev = data?.Device?.DeviceInfo ?? data;
      const model = dev?.Model ?? "DM-NVX";
      const serial = dev?.SerialNumber ?? null;
      const firmware = dev?.FirmwareVersion ?? null;
      return sample(target, {
        reachability: "reachable", health: "unknown", auth: context.credential ? "ok" : "unknown",
        metrics: { model, serialNumber: serial, firmwareVersion: firmware, protocol: "crestron-nvx-rest" }
      });
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      if (err && typeof err === "object" && (err as any).name === "AbortError") {
        throw new ConnectorError("transport", "Crestron DM NVX response timeout", "unknown");
      }
      throw new ConnectorError("transport", "Crestron DM NVX connection failed", "unreachable");
    } finally {
      clearTimeout(timer);
    }
  },
};
