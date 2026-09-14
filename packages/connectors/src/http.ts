import { ConnectorError, sample, type Connector, type ConnectorContext, type EnrolledTarget, type SimulatorAction } from "./types.js";
import { validateTarget } from "./scope.js";
/** Shared bounded reader: do not trust Content-Length and do not follow redirects off the enrolled target. */
export async function readBoundedJson(response: Response, maxBytes = 65536): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ConnectorError("protocol", "Empty HTTP response", "reachable");
  const parts: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      count += next.value.byteLength;
      if (count > maxBytes) throw new ConnectorError("protocol", "Oversized HTTP response", "reachable");
      parts.push(next.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof ConnectorError ? error : new ConnectorError("protocol", "Invalid HTTP JSON response", "reachable");
  } finally { reader.releaseLock(); }
}
function assertSimulator(target: EnrolledTarget, context: ConnectorContext): void {
  validateTarget(target, context);
  if (target.connectorId !== "simulator-http" || target.sourceMode !== "simulated") throw new ConnectorError("unsupported", "Simulator adapter requires an enrolled simulated target");
}
async function request(target: EnrolledTarget, context: ConnectorContext, path: string, init: RequestInit = {}): Promise<unknown> {
  assertSimulator(target, context);
  try {
    const response = await fetch(`http://${target.address}:${target.port ?? 4410}${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(context.timeoutMs ?? 3000),
      headers: { "content-type": "application/json", ...(context.credential ? { authorization: `Bearer ${context.credential}` } : {}), ...init.headers },
    });
    if (response.status === 401 || response.status === 403) throw new ConnectorError("authentication", "Simulator credentials rejected", "reachable");
    if (!response.ok) throw new ConnectorError(response.status === 404 ? "unsupported" : "protocol", "Simulator request rejected", "reachable");
    return await readBoundedJson(response);
  } catch (error) { throw error instanceof ConnectorError ? error : new ConnectorError("transport", "Simulator request failed"); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectorError("protocol", "Expected JSON object", "reachable");
  return value as Record<string, unknown>;
}
export const simulatorConnector: Connector = {
  id: "simulator-http", async read(target, context) {
    const value = record(await request(target, context, `/devices/${encodeURIComponent(target.deviceId)}/health`));
    if (value.deviceId !== target.deviceId || value.sourceMode !== "simulated") throw new ConnectorError("protocol", "Simulator identity does not match enrollment", "reachable");
    if (!["reachable", "unreachable", "unknown"].includes(String(value.reachability)) || !["healthy", "warning", "error", "unknown"].includes(String(value.health)) || !["ok", "failed", "unknown"].includes(String(value.auth))) throw new ConnectorError("protocol", "Invalid simulator observation", "reachable");
    // Only named simulator measurements cross this boundary; arbitrary server fields never become evidence.
    const input = record(value.metrics ?? {}), metrics: Record<string, unknown> = {};
    for (const key of ["temperatureC", "service", "serviceStatus", "fault", "upstreamDeviceId", "ports", "revision", "protocol"]) if (Object.hasOwn(input, key)) metrics[key] = input[key];
    return sample(target, { reachability: value.reachability as "reachable" | "unreachable" | "unknown", health: value.health as "healthy" | "warning" | "error" | "unknown", auth: value.auth as "ok" | "failed" | "unknown", metrics });
  },
};
export interface SimulatorCommandResult { commandId: string; status: "completed" | "failed" | "unknown"; deviceId: string }
export async function executeSimulatorAction(target: EnrolledTarget, context: ConnectorContext, commandId: string, action: SimulatorAction, args: Record<string, unknown> = {}): Promise<SimulatorCommandResult> {
  assertSimulator(target, context);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(commandId)) throw new Error("Invalid command ID");
  if (action !== "restart_service" && action !== "restart_switch") throw new ConnectorError("unsupported", "Only simulator recovery actions are executable");
  if (Object.keys(args).length !== 0) throw new ConnectorError("unsupported", "Unsupported simulator action arguments");
  const value = record(await request(target, context, `/devices/${encodeURIComponent(target.deviceId)}/actions`, { method: "POST", body: JSON.stringify({ commandId, name: action, arguments: args }) }));
  if (value.commandId !== commandId || value.deviceId !== target.deviceId || !["completed", "failed", "unknown"].includes(String(value.status))) throw new ConnectorError("protocol", "Invalid command result", "reachable");
  return value as unknown as SimulatorCommandResult;
}
export async function reconcileSimulatorCommand(target: EnrolledTarget, context: ConnectorContext, commandId: string): Promise<SimulatorCommandResult> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(commandId)) throw new Error("Invalid command ID");
  const value = record(await request(target, context, `/commands/${encodeURIComponent(commandId)}`));
  if (value.commandId !== commandId || value.deviceId !== target.deviceId || !["completed", "failed", "unknown"].includes(String(value.status))) throw new ConnectorError("protocol", "Invalid reconciled result", "reachable");
  return value as unknown as SimulatorCommandResult;
}
