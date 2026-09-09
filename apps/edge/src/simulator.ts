import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { JsonStore } from "./store.js";
export type SimulatedFault = "none" | "offline" | "service_hang" | "authentication_failure" | "recovery_failure";
export interface SimulatedDevice { deviceId: string; kind: "switch" | "device"; upstreamDeviceId?: string; fault: SimulatedFault; revision: number }
interface SimulatedCommand { commandId: string; deviceId: string; fingerprint: string; status: "completed" | "failed"; executions: number }
export interface SimulatorState { version: 1; devices: Record<string, SimulatedDevice>; commands: Record<string, SimulatedCommand> }
const faults = new Set<SimulatedFault>(["none", "offline", "service_hang", "authentication_failure", "recovery_failure"]);
function authorized(request: IncomingMessage, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`), received = Buffer.from(request.headers.authorization ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
function reply(response: ServerResponse, status: number, body: object): void { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let count = 0; const parts: Buffer[] = [];
  for await (const chunk of request) { const bytes = Buffer.from(chunk as Uint8Array); count += bytes.length; if (count > 4096) throw new Error("Request too large"); parts.push(bytes); }
  const value: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body"); return value as Record<string, unknown>;
}
export function initialSimulatorState(devices: { deviceId: string; kind: "switch" | "device"; upstreamDeviceId?: string }[]): SimulatorState {
  const output: SimulatorState = { version: 1, devices: {}, commands: {} };
  if (devices.length > 256) throw new Error("Simulator device limit exceeded");
  for (const device of devices) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(device.deviceId) || Object.hasOwn(output.devices, device.deviceId) || ["__proto__", "constructor", "prototype"].includes(device.deviceId)) throw new Error("Invalid or duplicate simulator ID");
    if (device.kind !== "switch" && device.kind !== "device") throw new Error("Invalid simulated device kind");
    output.devices[device.deviceId] = { ...device, fault: "none", revision: 0 };
  }
  for (const device of Object.values(output.devices)) {
    if (device.upstreamDeviceId && (output.devices[device.upstreamDeviceId]?.kind !== "switch" || device.upstreamDeviceId === device.deviceId)) throw new Error("Simulator upstream must reference another enrolled switch");
    const seen = new Set<string>(); let cursor: SimulatedDevice | undefined = device;
    while (cursor) { if (seen.has(cursor.deviceId)) throw new Error("Simulator topology must be acyclic"); seen.add(cursor.deviceId); cursor = cursor.upstreamDeviceId ? output.devices[cursor.upstreamDeviceId] : undefined; }
  }
  return output;
}
function isDown(device: SimulatedDevice, devices: Record<string, SimulatedDevice>, seen = new Set<string>()): boolean {
  if (seen.has(device.deviceId)) return true;
  seen.add(device.deviceId);
  return device.fault === "offline" || device.fault === "recovery_failure" || !!(device.upstreamDeviceId && devices[device.upstreamDeviceId] && isDown(devices[device.upstreamDeviceId]!, devices, seen));
}
/** Standalone simulator, separate from the backend's hosted scenarios. All routes require a local simulator token. */
export function createSimulator(store: JsonStore<SimulatorState>, token: string, adminToken: string): Server {
  if (!token || !adminToken || token === adminToken) throw new Error("Distinct simulator and scenario-admin secrets are required");
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url ?? "/", "http://simulator.local");
    const admin = url.pathname.startsWith("/faults/");
    if (!authorized(request, admin ? adminToken : token)) { reply(response, 401, { error: "unauthorized" }); return; }
    const path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (request.method === "POST" && path[0] === "faults" && path.length === 2) {
      const input = await body(request);
      if (!faults.has(input.fault as SimulatedFault)) { reply(response, 400, { error: "unsupported_fault" }); return; }
      const id = path[1]!;
      if (!store.snapshot().devices[id]) { reply(response, 404, { error: "not_found" }); return; }
      await store.update((state) => { state.devices[id]!.fault = input.fault as SimulatedFault; state.devices[id]!.revision++; });
      reply(response, 200, { deviceId: id, fault: input.fault }); return;
    }
    if (request.method === "GET" && path[0] === "commands" && path.length === 2) {
      const command = store.snapshot().commands[path[1]!];
      reply(response, command ? 200 : 404, command ? { commandId: command.commandId, deviceId: command.deviceId, status: command.status } : { error: "not_found" }); return;
    }
    const state = store.snapshot(), device = path[0] === "devices" && path[1] ? state.devices[path[1]] : undefined;
    if (!device) { reply(response, 404, { error: "not_found" }); return; }
    if (request.method === "GET" && path[2] === "health" && path.length === 3) {
      if (device.fault === "authentication_failure") { reply(response, 401, { error: "simulated_authentication_failure" }); return; }
      const down = isDown(device, state.devices);
      reply(response, 200, { deviceId: device.deviceId, sourceMode: "simulated", reachability: down ? "unreachable" : "reachable", health: down ? "unknown" : device.fault === "service_hang" ? "error" : "healthy", auth: "ok",
        metrics: { fault: device.fault, service: "telemetry", serviceStatus: device.fault === "service_hang" ? "unresponsive" : "running", temperatureC: 34, revision: device.revision, ...(device.upstreamDeviceId ? { upstreamDeviceId: device.upstreamDeviceId } : {}) } }); return;
    }
    if (request.method === "POST" && path[2] === "actions" && path.length === 3) {
      const input = await body(request);
      if (typeof input.commandId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.commandId) || !["restart_service", "restart_switch"].includes(String(input.name)) || !input.arguments || typeof input.arguments !== "object" || Array.isArray(input.arguments) || Object.keys(input.arguments).length !== 0) { reply(response, 400, { error: "unsupported_action" }); return; }
      const commandId = input.commandId, fingerprint = createHash("sha256").update(JSON.stringify({ deviceId: device.deviceId, name: input.name, arguments: {} })).digest("hex");
      let conflict = false;
      await store.update((next) => {
        const prior = next.commands[commandId];
        if (prior) { conflict = prior.fingerprint !== fingerprint; return; }
        if (Object.keys(next.commands).length >= 10000) throw new Error("Simulator command log is full");
        const target = next.devices[device.deviceId]!;
        const supported = (input.name === "restart_switch" && target.kind === "switch") || (input.name === "restart_service" && target.kind === "device");
        if (supported && target.fault !== "recovery_failure") { target.fault = "none"; target.revision++; }
        next.commands[commandId] = { commandId, deviceId: target.deviceId, fingerprint, status: supported ? "completed" : "failed", executions: supported ? 1 : 0 };
      });
      if (conflict) reply(response, 409, { error: "idempotency_conflict" });
      else { const result = store.snapshot().commands[commandId]!; reply(response, 200, { commandId, deviceId: result.deviceId, status: result.status }); }
      return;
    }
    reply(response, 404, { error: "not_found" });
  })().catch(() => { if (!response.headersSent) reply(response, 400, { error: "invalid_request" }); else response.destroy(); }); });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
  return server;
}
