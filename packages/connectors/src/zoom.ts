import { ConnectorError, sample, type Connector } from "./types.js";
import { validateTarget } from "./scope.js";

/** Zoom Rooms Cloud REST API. */
export const zoomConnector: Connector = {
  id: "zoom-rooms",
  async read(target, context) {
    validateTarget(target, context);
    const timeout = context.timeoutMs ?? 3000;
    // In local simulator tests, target.address:port is the mock server; in production it targets api.zoom.us
    const base = target.address.includes("zoom.us") ? "https://api.zoom.us" : `http://${target.address}:${target.port ?? 80}`;
    const url = `${base}/v2/rooms/${encodeURIComponent(target.deviceId)}`;
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (context.credential) {
      headers["Authorization"] = context.credential.startsWith("Bearer ") ? context.credential : `Bearer ${context.credential}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectorError("authentication", "Zoom Rooms OAuth token unauthorized", "reachable");
      }
      if (!response.ok) {
        throw new ConnectorError("transport", `Zoom Rooms HTTP error ${response.status}`, "reachable");
      }
      const data = await response.json() as Record<string, any>;
      const roomStatus = data?.status ?? null;
      const roomHealth = typeof data?.health === "string" ? data.health : null;
      const mic = data?.devices?.microphone ?? null;
      const speaker = data?.devices?.speaker ?? null;
      const camera = data?.devices?.camera ?? null;
      const health = roomHealth === "Good" ? "healthy" : roomHealth === "Warning" ? "warning" : roomHealth ? "error" : "unknown";
      return sample(target, {
        reachability: "reachable", health, auth: context.credential ? "ok" : "unknown",
        metrics: {
          roomStatus, roomHealth, microphoneStatus: mic, speakerStatus: speaker, cameraStatus: camera,
          protocol: "zoom-rooms-api"
        }
      });
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      if (err && typeof err === "object" && (err as any).name === "AbortError") {
        throw new ConnectorError("transport", "Zoom Rooms response timeout", "unknown");
      }
      throw new ConnectorError("transport", "Zoom Rooms connection failed", "unreachable");
    } finally {
      clearTimeout(timer);
    }
  },
};
