import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { CredentialVault, simulatorConnector, executeSimulatorAction, type EnrolledTarget } from "@deviceops/connectors";
import { JsonStore, acquireProcessLock } from "./store.js";
import { createSimulator, initialSimulatorState, type SimulatorState } from "./simulator.js";
import { EdgeCollector, initialCollectorState, retryDelay, type CollectorState } from "./collector.js";
import { parseConfig, validateBackendUrl } from "./config.js";
import { discoverTargets } from "./discovery.js";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function temporary(): Promise<string> { const path = await mkdtemp(join(tmpdir(), "deviceops-edge-")); cleanups.push(() => rm(path, { recursive: true, force: true })); return path; }
async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return (server.address() as { port: number }).port;
}
async function fixture(): Promise<{ state: JsonStore<SimulatorState>; port: number; directory: string; server: Server }> {
  const directory = await temporary();
  const state = await JsonStore.load(join(directory, "sim.json"), initialSimulatorState([{ deviceId: "switch", kind: "switch" }, { deviceId: "projector", kind: "device", upstreamDeviceId: "switch" }]));
  const server = createSimulator(state, "simulation-secret", "admin-secret"), port = await listen(server);
  return { state, port, directory, server };
}
const context = { allowedTargets: ["127.0.0.1/32"], timeoutMs: 500, credential: "simulation-secret" };
function target(port: number, deviceId = "switch"): EnrolledTarget { return { deviceId, connectorId: "simulator-http", sourceMode: "simulated", address: "127.0.0.1", port, credentialRef: "simulator" }; }
function config(targets: EnrolledTarget[]) { return parseConfig({ collectorId: "collector-a", allowedTargets: ["127.0.0.1/32"], targets, pollIntervalMs: 1000, timeoutMs: 500, concurrency: 4 }); }
function command(id = "command-1") { return { id, deviceId: "switch", sourceMode: "simulated", name: "restart_switch", arguments: {}, expiresAt: new Date(Date.now() + 60000).toISOString() }; }
describe("standalone edge simulator", () => {
  it("propagates an upstream fault and makes recovery idempotent across reloads", async () => {
    const { state, port, directory } = await fixture();
    await state.update((value) => { value.devices.switch!.fault = "offline"; });
    expect((await simulatorConnector.read(target(port, "projector"), context)).reachability).toBe("unreachable");
    await executeSimulatorAction(target(port), context, "command-1", "restart_switch", {});
    await executeSimulatorAction(target(port), context, "command-1", "restart_switch", {});
    expect((await simulatorConnector.read(target(port, "projector"), context)).health).toBe("healthy");
    const restored = await JsonStore.load(join(directory, "sim.json"), initialSimulatorState([]));
    expect(restored.snapshot().commands["command-1"]?.executions).toBe(1); expect(restored.snapshot().devices.switch!.revision).toBe(1);
    await expect(executeSimulatorAction(target(port, "projector"), context, "command-1", "restart_service", {})).rejects.toMatchObject({ kind: "protocol" });
  });
  it("acknowledges a simulated recovery failure without claiming healthy telemetry", async () => {
    const { state, port } = await fixture(); await state.update((value) => { value.devices.switch!.fault = "recovery_failure"; });
    expect((await executeSimulatorAction(target(port), context, "command-fail", "restart_switch", {})).status).toBe("completed");
    expect((await simulatorConnector.read(target(port), context)).reachability).toBe("unreachable");
  });
  it("refuses real targets, arbitrary action arguments, and collector access to fault injection", async () => {
    const { port } = await fixture();
    await expect(executeSimulatorAction({ ...target(port), sourceMode: "live" }, context, "nope", "restart_switch", {})).rejects.toMatchObject({ kind: "unsupported" });
    await expect(executeSimulatorAction(target(port), context, "nope", "restart_switch", { shell: "id" })).rejects.toMatchObject({ kind: "unsupported" });
    const response = await fetch(`http://127.0.0.1:${port}/faults/switch`, { method: "POST", headers: { authorization: "Bearer simulation-secret" }, body: JSON.stringify({ fault: "offline" }) });
    expect(response.status).toBe(401);
  });
});
describe("edge collector durability and authorization", () => {
  it("spools during backend failure and flushes exact original observations after reconnect", async () => {
    const { port, directory } = await fixture(), state = await JsonStore.load<CollectorState>(join(directory, "edge.json"), initialCollectorState());
    const vault = new CredentialVault(join(directory, "vault.json"), randomBytes(32).toString("base64")); await vault.set("simulator", "simulation-secret");
    let unavailable = true; const batches: unknown[] = [];
    const backend = createServer((request, response) => { void (async () => {
      expect(request.headers.authorization).toBe("Bearer scoped-token");
      if (unavailable) { response.writeHead(503); response.end(); return; }
      let raw = ""; for await (const data of request) raw += String(data);
      if (request.url?.endsWith("/observations")) batches.push(JSON.parse(raw));
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(request.url?.endsWith("/commands") ? { commands: [] } : { ok: true }));
    })(); });
    const backendPort = await listen(backend), collector = new EdgeCollector(config([target(port)]), state, `http://127.0.0.1:${backendPort}`, "scoped-token", vault);
    await collector.tick(); const original = state.snapshot().observations; expect(original).toHaveLength(1);
    const reloaded = await JsonStore.load<CollectorState>(join(directory, "edge.json"), initialCollectorState()); expect(reloaded.snapshot().observations).toEqual(original);
    unavailable = false; await collector.tick(); expect(state.snapshot().observations).toEqual([]); expect(batches).toEqual([{ observations: original }]);
  });
  it("pauses all adapters sharing a rejected credential and persists the pause", async () => {
    const { port, directory, server } = await fixture(), state = await JsonStore.load<CollectorState>(join(directory, "edge.json"), initialCollectorState());
    const vault = new CredentialVault(join(directory, "vault.json"), randomBytes(32).toString("base64")); await vault.set("simulator", "wrong-secret");
    let requests = 0; server.on("request", () => requests++);
    const collector = new EdgeCollector(config([target(port), target(port, "projector")]), state, "http://127.0.0.1:1", "scoped-token", vault);
    await collector.poll(); await collector.poll(); expect(requests).toBe(1);
    expect(state.snapshot().observations[0]).toMatchObject({ reachability: "reachable", auth: "failed" });
    expect((await JsonStore.load<CollectorState>(join(directory, "edge.json"), initialCollectorState())).snapshot().pausedCredentials.simulator).toBe(true);
  });
  it("reconciles a crash after execution instead of executing again, and rejects changed or expired commands", async () => {
    const { state: simulatorState, port, directory } = await fixture(), state = await JsonStore.load<CollectorState>(join(directory, "edge.json"), initialCollectorState());
    const vault = new CredentialVault(join(directory, "vault.json"), randomBytes(32).toString("base64")); await vault.set("simulator", "simulation-secret");
    await executeSimulatorAction(target(port), context, "command-1", "restart_switch", {});
    const fingerprint = createHash("sha256").update(JSON.stringify({ deviceId: "switch", name: "restart_switch", arguments: {} })).digest("hex");
    await state.update((value) => { value.commands["command-1"] = { fingerprint, deviceId: "switch", phase: "prepared", reported: false, updatedAt: new Date().toISOString() }; });
    const collector = new EdgeCollector(config([target(port), target(port, "projector")]), state, "http://127.0.0.1:1", "scoped-token", vault);
    await collector.recoverPreparedCommands(); expect(state.snapshot().commands["command-1"]?.phase).toBe("completed");
    await collector.handleCommand(command()); await collector.handleCommand({ ...command(), deviceId: "projector", name: "restart_service" });
    await collector.handleCommand({ ...command("expired"), expiresAt: new Date(0).toISOString() });
    await collector.handleCommand({ ...command("foreign"), deviceId: "not-enrolled" });
    expect(Object.keys(simulatorState.snapshot().commands)).toEqual(["command-1"]); expect(simulatorState.snapshot().commands["command-1"]?.executions).toBe(1);
  });
  it("does not repeat an unknown action outcome", async () => {
    const directory = await temporary(), state = await JsonStore.load<CollectorState>(join(directory, "edge.json"), initialCollectorState());
    const collector = new EdgeCollector(config([target(1)]), state, "http://127.0.0.1:1", "scoped-token");
    await collector.handleCommand(command()); expect(state.snapshot().commands["command-1"]?.phase).toBe("unknown");
    const before = state.snapshot().commands; await collector.handleCommand(command()); expect(state.snapshot().commands).toEqual(before);
  });
  it("prevents another process from using the same command journal", async () => {
    const directory = await temporary(), lock = join(directory, "edge.lock"), release = await acquireProcessLock(lock);
    await expect(acquireProcessLock(lock)).rejects.toThrow(/Another edge process/); await release(); const second = await acquireProcessLock(lock); await second();
  });
});
describe("configuration and staged discovery", () => {
  it("rejects unconfigured addresses, accidental plaintext backend tokens, and planned adapters", () => {
    expect(() => config([{ ...target(4410), address: "10.0.0.1" }])).toThrow(/allowlist/);
    expect(() => parseConfig({ ...config([]), targets: [{ ...target(4410), connectorId: "crestron-xio" }] })).toThrow(/planned/);
    expect(() => validateBackendUrl("http://example.com", false)).toThrow(/HTTPS/);
    expect(() => validateBackendUrl("https://secret@example.com", false)).toThrow(/credentials/);
    expect(retryDelay(100, 30000, 0.5)).toBe(300000);
  });
  it("returns candidates requiring approval without creating enrollment", async () => {
    const result = await discoverTargets(["127.0.0.1/32"], { allowedTargets: ["127.0.0.1/32"], timeoutMs: 1000 });
    expect(result.scanned).toBe(1); expect(result.candidates[0]).toMatchObject({ address: "127.0.0.1", status: "candidate", enrollmentRequired: true });
    await expect(discoverTargets(["127.0.0.1/32"], context, { connectorId: "simulator-http" })).rejects.toThrow(/explicit simulator/);
  });
});
