import { createHash } from "node:crypto";
import { connectors, failedSample, executeSimulatorAction, reconcileSimulatorCommand, readBoundedJson, type ConnectorContext, type CredentialVault, type EnrolledTarget, type Observation, type SimulatorAction } from "@deviceops/connectors";
import { JsonStore } from "./store.js";
import { validateBackendUrl, type EdgeConfig } from "./config.js";
interface Retry { failures: number; nextPollAt: number }
interface CommandRecord {
  fingerprint: string; deviceId: string; phase: "prepared" | "completed" | "failed" | "unknown";
  reported: boolean; updatedAt: string;
}
export interface CollectorState {
  version: 1; observations: Observation[]; droppedObservations: number;
  pausedCredentials: Record<string, boolean>; retries: Record<string, Retry>; commands: Record<string, CommandRecord>;
}
export const initialCollectorState = (): CollectorState => ({ version: 1, observations: [], droppedObservations: 0, pausedCredentials: {}, retries: {}, commands: {} });
export interface CollectorCommand { id: string; deviceId: string; name: SimulatorAction; arguments: Record<string, unknown>; sourceMode: "simulated"; expiresAt: string }
export type CollectorLog = (event: string, detail?: Record<string, unknown>) => void;
function validCommand(value: unknown): value is CollectorCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<CollectorCommand>;
  return typeof command.id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(command.id) && typeof command.deviceId === "string"
    && command.sourceMode === "simulated" && ["restart_service", "restart_switch"].includes(command.name ?? "")
    && !!command.arguments && typeof command.arguments === "object" && !Array.isArray(command.arguments) && Object.keys(command.arguments).length === 0
    && typeof command.expiresAt === "string" && Number.isFinite(Date.parse(command.expiresAt));
}
export function retryDelay(failures: number, pollIntervalMs: number, random = Math.random()): number {
  return Math.round(Math.min(300000, pollIntervalMs * 2 ** Math.min(Math.max(0, failures - 1), 6)) * (0.9 + Math.max(0, Math.min(1, random)) * 0.2));
}
export class EdgeCollector {
  private readonly baseUrl: string;
  private readonly credentialQueues = new Map<string, Promise<void>>();
  private commandQueue: Promise<void> = Promise.resolve();
  constructor(readonly config: EdgeConfig, private readonly state: JsonStore<CollectorState>, backendUrl: string,
    private readonly token: string, private readonly vault?: CredentialVault, private readonly log: CollectorLog = () => undefined) {
    this.baseUrl = validateBackendUrl(backendUrl, config.allowInsecureHttp);
    if (!token || /[\r\n]/.test(token)) throw new Error("DEVICEOPS_COLLECTOR_TOKEN is required");
    const current = state.snapshot();
    if (current.version !== 1 || !Array.isArray(current.observations) || !current.commands || !current.retries || !current.pausedCredentials) throw new Error("Invalid state version/shape");
  }
  private async api(path: string, body?: object): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/v2/collector${path}`, { method: body ? "POST" : "GET", redirect: "error",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Collector API rejected request (${response.status})`);
    return response.status === 204 ? null : readBoundedJson(response, 1024 * 1024);
  }
  private async context(target: EnrolledTarget): Promise<ConnectorContext> {
    const credential = target.credentialRef ? await this.vault?.get(target.credentialRef) : undefined;
    return { allowedTargets: this.config.allowedTargets, timeoutMs: this.config.timeoutMs, ...(credential ? { credential } : {}) };
  }
  private async pollTarget(target: EnrolledTarget): Promise<void> {
    // Serialize credential-sharing probes. The first auth failure pauses related adapters before another request.
    const lockKey = target.credentialRef ?? `${target.deviceId}:${target.connectorId}`;
    const previous = this.credentialQueues.get(lockKey) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const key = `${target.deviceId}:${target.connectorId}`, current = this.state.snapshot();
      if (target.credentialRef && current.pausedCredentials[target.credentialRef]) return;
      if ((current.retries[key]?.nextPollAt ?? 0) > Date.now()) return;
      let observation: Observation;
      try { observation = await connectors[target.connectorId].read(target, await this.context(target)); }
      catch (error) { observation = failedSample(target, error); }
      await this.state.update((state) => {
        state.observations.push(observation);
        if (state.observations.length > 10000) { const excess = state.observations.length - 10000; state.observations.splice(0, excess); state.droppedObservations += excess; }
        const failed = observation.metrics.errorKind === "transport" || observation.reachability === "unreachable";
        const failures = failed ? (state.retries[key]?.failures ?? 0) + 1 : 0;
        state.retries[key] = { failures, nextPollAt: Date.now() + (failed ? retryDelay(failures, this.config.pollIntervalMs) : this.config.pollIntervalMs) };
        if (observation.auth === "failed" && target.credentialRef) state.pausedCredentials[target.credentialRef] = true;
      });
      if (observation.auth === "failed") this.log("credential_paused", { deviceId: target.deviceId, source: target.connectorId });
    });
    this.credentialQueues.set(lockKey, operation.catch(() => undefined)); await operation;
  }
  async poll(): Promise<void> {
    let cursor = 0;
    await Promise.all(Array.from({ length: this.config.concurrency }, async () => {
      while (cursor < this.config.targets.length) { const target = this.config.targets[cursor++]!; await this.pollTarget(target); }
    }));
  }
  async flushObservations(): Promise<void> {
    // Backend accepts a 24-hour clock window. Purge expired spool data rather than permanently blocking newer samples.
    const cutoff = Date.now() - 86340000;
    if (this.state.snapshot().observations.some((item) => Date.parse(item.observedAt) < cutoff)) await this.state.update((state) => {
      const previous = state.observations.length;
      state.observations = state.observations.filter((item) => Date.parse(item.observedAt) >= cutoff);
      state.droppedObservations += previous - state.observations.length;
    });
    for (let index = 0; index < 5; index++) {
      const batch = this.state.snapshot().observations.slice(0, 100); if (!batch.length) return;
      await this.api("/observations", { observations: batch });
      await this.state.update((state) => { state.observations.splice(0, batch.length); });
    }
  }
  async handleCommand(value: unknown): Promise<void> {
    const operation = this.commandQueue.then(() => this.processCommand(value));
    this.commandQueue = operation.catch(() => undefined);
    await operation;
  }
  private async processCommand(value: unknown): Promise<void> {
    if (!validCommand(value)) { this.log("command_rejected", { reason: "invalid_shape" }); return; }
    const command = value;
    const target = this.config.targets.find((item) => item.deviceId === command.deviceId && item.connectorId === "simulator-http" && item.sourceMode === "simulated");
    if (!target || Date.parse(command.expiresAt) <= Date.now()) { this.log("command_rejected", { commandId: command.id, reason: "not_enrolled_simulator_or_expired" }); return; }
    const fingerprint = createHash("sha256").update(JSON.stringify({ deviceId: command.deviceId, name: command.name, arguments: command.arguments })).digest("hex");
    const existing = this.state.snapshot().commands[command.id];
    if (existing && existing.fingerprint !== fingerprint) { this.log("command_rejected", { commandId: command.id, reason: "idempotency_conflict" }); return; }
    if (existing && existing.phase !== "prepared") return;
    if (!existing) {
      await this.state.update((state) => {
        if (Object.keys(state.commands).length >= 10000) throw new Error("Command history is full; archive state after stopping the collector");
        state.commands[command.id] = { fingerprint, deviceId: command.deviceId, phase: "prepared", reported: false, updatedAt: new Date().toISOString() };
      });
    }
    let phase: CommandRecord["phase"] = "unknown";
    try {
      const context = await this.context(target);
      const result = existing ? await reconcileSimulatorCommand(target, context, command.id) : await executeSimulatorAction(target, context, command.id, command.name, command.arguments);
      phase = result.status;
    } catch { this.log("command_outcome_unknown", { commandId: command.id }); }
    await this.state.update((state) => { const record = state.commands[command.id]!; record.phase = phase; record.updatedAt = new Date().toISOString(); });
  }
  async recoverPreparedCommands(): Promise<void> {
    for (const [commandId, record] of Object.entries(this.state.snapshot().commands)) {
      if (record.phase !== "prepared") continue;
      const target = this.config.targets.find((item) => item.deviceId === record.deviceId && item.connectorId === "simulator-http" && item.sourceMode === "simulated");
      let phase: "completed" | "failed" | "unknown" = "unknown";
      if (target) {
        try { phase = (await reconcileSimulatorCommand(target, await this.context(target), commandId)).status; }
        catch { this.log("command_reconciliation_unknown", { commandId }); }
      }
      await this.state.update((state) => { state.commands[commandId]!.phase = phase; state.commands[commandId]!.updatedAt = new Date().toISOString(); });
    }
  }
  async flushCommandResults(): Promise<void> {
    for (const [commandId, record] of Object.entries(this.state.snapshot().commands)) {
      if (record.reported || record.phase === "prepared") continue;
      await this.api(`/commands/${encodeURIComponent(commandId)}/result`, { commandId, deviceId: record.deviceId, status: record.phase });
      await this.state.update((state) => { state.commands[commandId]!.reported = true; });
    }
  }
  async tick(): Promise<void> {
    await this.poll();
    try {
      const state = this.state.snapshot();
      await this.api("/heartbeat", { collectorId: this.config.collectorId, queueDepth: state.observations.length, droppedObservations: state.droppedObservations, pausedCredentialCount: Object.keys(state.pausedCredentials).length });
      await this.flushObservations(); await this.recoverPreparedCommands(); await this.flushCommandResults();
      const response = await this.api("/commands") as { commands?: unknown[] };
      if (!response || !Array.isArray(response.commands) || response.commands.length > 100) throw new Error("Invalid collector command batch");
      for (const command of response.commands) await this.handleCommand(command);
      await this.flushCommandResults();
    } catch { this.log("backend_unavailable", { queuedObservations: this.state.snapshot().observations.length }); }
  }
}
