import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const ObservationSchema = z
  .object({
    deviceId: z.uuid(),
    source: z.string().min(1).max(80),
    sourceMode: z.enum(["simulated", "live"]),
    observedAt: z.iso.datetime({ offset: true }),
    reachability: z.enum(["reachable", "unreachable", "unknown"]),
    health: z.enum(["healthy", "warning", "error", "unknown"]),
    auth: z.enum(["ok", "failed", "unknown"]),
    metrics: z
      .record(
        z.string().max(80),
        z.union([
          z.string().max(400),
          z.number().finite(),
          z.boolean(),
          z.null(),
        ]),
      )
      .default({}),
  })
  .strict();
export type Observation = z.infer<typeof ObservationSchema> & {
  id: string;
  receivedAt: string;
};
export type Device = {
  id: string;
  name: string;
  room: string;
  kind: string;
  sourceMode: "simulated" | "live";
  health: "online" | "warning" | "error" | "offline" | "unknown";
  reachability: string;
  auth: string;
  observedAt: string | null;
  conflict: boolean;
  metrics: Record<string, unknown>;
  failures: number;
  healthySamples: number;
  collectorManaged?: boolean;
  pollIntervalMs?: number;
};
export type Incident = {
  id: string;
  summary: string;
  cause: string;
  status:
    | "detected"
    | "investigating"
    | "awaiting_approval"
    | "executing"
    | "verifying"
    | "resolved"
    | "escalated"
    | "cancelled";
  severity: string;
  deviceIds: string[];
  rootDeviceId: string;
  createdAt: string;
  updatedAt: string;
  diagnosis: Diagnosis | null;
  report: Record<string, unknown> | null;
  invocationId: string | null;
  verificationStartedAt: string | null;
  healthySamples: number;
  generation: number;
};
export const DiagnosisSchema = z
  .object({
    summary: z.string().min(1).max(1200),
    cause: z.string().min(1).max(1000),
    evidenceIds: z.array(z.string().min(1)).min(1).max(40),
    alternatives: z.array(z.string().max(400)).max(5),
    uncertainty: z.string().max(1000),
    action: z
      .object({
        name: z.enum(["restart_service", "restart_switch"]),
        targetDeviceId: z.uuid(),
        arguments: z.object({}).strict(),
      })
      .strict()
      .nullable(),
    provider: z.enum(["fixture", "strands-bedrock", "strands-gemini"]),
    modelId: z.string(),
    usage: z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      modelCalls: z.number().int().nonnegative(),
    }),
    toolCalls: z.number().int().nonnegative(),
  })
  .strict();
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Proposal = {
  id: string;
  incidentId: string;
  name: "restart_service" | "restart_switch";
  targetDeviceId: string;
  risk: "automatic" | "approval_required";
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "expired"
    | "executed"
    | "cancelled";
  hash: string;
  expiresAt: string;
  evidenceIds: string[];
  preconditions: { generation: number; sourceMode: "simulated"; kind: string };
  requesterId: string | null;
  approverId: string | null;
  reason: string;
  requestedAt?: string;
  decidedAt?: string;
  policyVersion: string;
};
export type Command = {
  id: string;
  incidentId: string;
  proposalId: string;
  deviceId: string;
  name: Proposal["name"];
  status: "queued" | "running" | "succeeded" | "failed" | "unknown";
  createdAt: string;
  expiresAt: string;
  executedAt: string | null;
  result: Record<string, unknown> | null;
};
export type Runbook = {
  id: string;
  title: string;
  text: string;
  version: string;
  published: boolean;
  embedding?: number[];
  embeddingModel?: string;
};
export type OpsEvent = {
  id: string;
  incidentId: string | null;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
};
export type State = {
  devices: Device[];
  observations: Observation[];
  incidents: Incident[];
  approvals: Proposal[];
  commands: Command[];
  runbooks: Runbook[];
  topology: Array<{ id: string; upstreamId: string; downstreamId: string }>;
  discovery: Array<{
    id: string;
    name: string;
    address: string;
    status: string;
  }>;
  events: OpsEvent[];
  scenario: string;
  scenarioStartedAt: string;
  lastPollAt: string;
  generation: number;
};
export const POLICY_VERSION = "2026-09-06.simulator.1";
export const MANAGER_ROLES = ["owner", "admin", "manager"];
export function stableHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function fixedId(tenant: string, name: string): string {
  const h = createHash("sha256").update(`${tenant}:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function event(
  s: State,
  type: string,
  data: Record<string, unknown>,
  now: number,
  incidentId: string | null = null,
) {
  s.events.push({
    id: randomUUID(),
    incidentId,
    type,
    data,
    createdAt: new Date(now).toISOString(),
  });
}
export function createState(tenant: string, now = Date.now()): State {
  const devices = ["switch", "display", "projector", "camera", "service"].map(
    (kind, i): Device => ({
      id: fixedId(tenant, kind),
      name: [
        "Campus switch",
        "Room B display",
        "Room B projector",
        "Room C camera",
        "Telemetry service",
      ][i]!,
      room:
        i === 0
          ? "Floor 2 network closet"
          : i === 4
            ? "Edge gateway"
            : i === 3
              ? "Conference Room C"
              : "Conference Room B",
      kind,
      sourceMode: "simulated",
      health: "unknown",
      reachability: "unknown",
      auth: "unknown",
      observedAt: null,
      conflict: false,
      metrics: {},
      failures: 0,
      healthySamples: 0,
    }),
  );
  const topics = [
    [
      "Upstream switch outage",
      "Check fresh switch reachability and port observations. Confirm explicit topology before grouping downstream faults. Restarting a shared switch requires manager approval. Verify the switch and every affected downstream device.",
    ],
    [
      "Telemetry service hung",
      "A reachable service host with application health error may have a hung telemetry process. Restart only the named simulated telemetry service when fresh evidence supports it. Verify three healthy samples.",
    ],
    [
      "Authentication failure",
      "Stop credential-dependent retries after authentication fails. Ask the operator to replace or verify the configured credential. A failed login does not establish an offline device.",
    ],
    [
      "Conflicting sources",
      "Compare source timestamps and dimensions. A stale cloud report cannot override fresh local health. Preserve conflicts and explain uncertainty.",
    ],
    [
      "Failed recovery",
      "A command acknowledgment is not recovery. Escalate if fresh observations remain unhealthy. Do not repeat disruptive actions blindly.",
    ],
    [
      "Missing topology",
      "If no dependency evidence exists, investigate devices separately. Do not claim an upstream cause from timing alone.",
    ],
    [
      "Transient network loss",
      "Require three consecutive transport failures before declaring offline. Bound timeout and exponential backoff.",
    ],
    [
      "Collector disconnected",
      "A stale collector means device state is unknown. Preserve last observation time and distinguish collector reachability.",
    ],
    [
      "Device overheating",
      "Confirm a fresh temperature reading against configured limits. Escalate to a technician for physical inspection. Never infer a factory reset as a safe response.",
    ],
    [
      "Discovery enrollment",
      "Probe only explicit configured targets. Stage candidates for manager review and assign their location before monitoring.",
    ],
  ];
  return {
    devices,
    observations: [],
    incidents: [],
    approvals: [],
    commands: [],
    topology: devices
      .slice(1, 4)
      .map((d) => ({
        id: fixedId(tenant, `edge-${d.kind}`),
        upstreamId: devices[0]!.id,
        downstreamId: d.id,
      })),
    runbooks: topics.map(([title, text], i) => ({
      id: fixedId(tenant, `runbook-${i}`),
      title: title!,
      text: text!,
      version: "1",
      published: true,
    })),
    discovery: [],
    events: [],
    scenario: "healthy",
    scenarioStartedAt: new Date(now).toISOString(),
    lastPollAt: new Date(0).toISOString(),
    generation: 0,
  };
}
export const ScenarioSchema = z.enum([
  "switch_failure",
  "service_hang",
  "auth_failure",
  "source_conflict",
  "recovery_failure",
  "reset",
]);
export function injectScenario(
  s: State,
  scenario: z.infer<typeof ScenarioSchema>,
  now = Date.now(),
) {
  s.generation++;
  s.scenario = scenario === "reset" ? "healthy" : scenario;
  s.scenarioStartedAt = new Date(now).toISOString();
  const builtIn = new Set(
    s.devices
      .filter((d) => !d.collectorManaged && d.sourceMode === "simulated")
      .map((d) => d.id),
  );
  for (const i of s.incidents.filter(
    (i) =>
      builtIn.has(i.rootDeviceId) &&
      !["resolved", "cancelled"].includes(i.status),
  )) {
    i.status = "cancelled";
    i.updatedAt = new Date(now).toISOString();
  }
  for (const p of s.approvals.filter(
    (p) =>
      builtIn.has(p.targetDeviceId) &&
      ["pending", "approved"].includes(p.status),
  ))
    p.status = "cancelled";
  for (const c of s.commands.filter(
    (c) => builtIn.has(c.deviceId) && c.status === "queued",
  ))
    c.status = "failed";
  for (const d of s.devices.filter((d) => builtIn.has(d.id))) {
    d.failures = 0;
    d.healthySamples = 0;
  }
  event(
    s,
    "simulator.fault_injected",
    { scenario: s.scenario, generation: s.generation },
    now,
  );
}
export function simulatorObservations(
  s: State,
  now: number,
): Array<z.infer<typeof ObservationSchema>> {
  return s.devices
    .filter((d) => d.sourceMode === "simulated" && !d.collectorManaged)
    .flatMap((d) => {
      const switchFault =
        ["switch_failure", "recovery_failure"].includes(s.scenario) &&
        ["switch", "display", "projector", "camera"].includes(d.kind);
      const authFault = s.scenario === "auth_failure" && d.kind === "projector";
      const serviceFault =
        s.scenario === "service_hang" && d.kind === "service";
      const o: z.infer<typeof ObservationSchema> = {
        deviceId: d.id,
        source: "simulator.local",
        sourceMode: "simulated",
        observedAt: new Date(now).toISOString(),
        reachability: switchFault ? "unreachable" : "reachable",
        health:
          switchFault || serviceFault
            ? "error"
            : authFault
              ? "unknown"
              : "healthy",
        auth: authFault ? "failed" : "ok",
        metrics: {
          temperatureC: 38,
          application: serviceFault ? "hung" : "ready",
          portsUp: switchFault ? 0 : 3,
        },
      };
      if (s.scenario === "source_conflict" && d.kind === "display")
        return [
          o,
          {
            ...o,
            source: "simulator.cloud",
            observedAt: new Date(now - 60000).toISOString(),
            health: "error",
            metrics: { application: "offline" },
          },
        ];
      return [o];
    });
}
export function ingest(
  s: State,
  raw: Array<z.infer<typeof ObservationSchema>>,
  now: number,
) {
  for (const input of raw) {
    const d = s.devices.find((d) => d.id === input.deviceId);
    if (!d) throw new Error("Device outside enrolled scope");
    if (d.sourceMode !== input.sourceMode)
      throw new Error("Source provenance mismatch");
    const t = Date.parse(input.observedAt);
    if (t > now + 5000 || now - t > 86400000)
      throw new Error("Observation outside allowed clock window");
    if (
      s.observations.some(
        (o) =>
          o.deviceId === input.deviceId &&
          o.source === input.source &&
          o.observedAt === input.observedAt,
      )
    )
      continue;
    s.observations.push({
      ...input,
      id: randomUUID(),
      receivedAt: new Date(now).toISOString(),
    });
  }
  // Bound hot history. Durable incident evidence is copied into each diagnosis report before compaction.
  if (s.observations.length > 3000) {
    const referenced = new Set(
      s.incidents
        .filter((i) => !i.report)
        .flatMap((i) => i.diagnosis?.evidenceIds ?? []),
    );
    s.observations = s.observations.filter(
      (o, i) => i >= s.observations.length - 2500 || referenced.has(o.id),
    );
  }
  for (const d of s.devices) {
    const latestBySource = new Map<string, Observation>();
    for (const o of s.observations.filter(
      (o) =>
        o.deviceId === d.id &&
        (d.collectorManaged ||
          Date.parse(o.observedAt) >= Date.parse(s.scenarioStartedAt) ||
          (o.source === "simulator.cloud" && s.scenario === "source_conflict")),
    )) {
      const old = latestBySource.get(o.source);
      if (!old || o.observedAt > old.observedAt)
        latestBySource.set(o.source, o);
    }
    const sources = [...latestBySource.values()].sort((a, b) =>
      b.observedAt.localeCompare(a.observedAt),
    );
    const freshness = 3 * (d.pollIntervalMs ?? 5000),
      freshSources = sources.filter(
        (o) => now - Date.parse(o.observedAt) <= freshness,
      );
    const current = freshSources[0],
      transport = freshSources.find((o) => o.reachability !== "unknown"),
      healthSource = freshSources.find((o) => o.health !== "unknown"),
      authSource = freshSources.find((o) => o.auth !== "unknown");
    // Reachability-only adapters contribute transport evidence, never an invented application-health vote.
    d.conflict = Boolean(
      healthSource &&
        sources.some(
          (o) =>
            o.health !== "unknown" &&
            o.health !== healthSource.health &&
            now - Date.parse(o.observedAt) <= 300000,
        ),
    );
    if (!current) {
      d.health = "unknown";
      d.reachability = "unknown";
      d.auth = "unknown";
      continue;
    }
    d.observedAt = current.observedAt;
    d.reachability = transport?.reachability ?? "unknown";
    d.auth = authSource?.auth ?? "unknown";
    d.metrics = { ...current.metrics, ...healthSource?.metrics };
    const consecutive = (
      source: Observation | undefined,
      valid: (o: Observation) => boolean,
      maxGap = freshness,
    ) => {
      if (!source) return 0;
      const samples = s.observations
        .filter(
          (o) =>
            o.deviceId === d.id &&
            o.source === source.source &&
            o.observedAt <= source.observedAt &&
            (d.collectorManaged ||
              Date.parse(o.observedAt) >= Date.parse(s.scenarioStartedAt)),
        )
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
      let count = 0,
        previous = Date.parse(source.observedAt);
      for (const o of samples) {
        const time = Date.parse(o.observedAt);
        if (previous - time > maxGap || !valid(o)) break;
        previous = time;
        if (++count === 3) break;
      }
      return count;
    };
    d.failures = consecutive(
      transport,
      (o) => o.reachability === "unreachable",
      d.collectorManaged ? Math.max(freshness, 330000) : freshness,
    );
    d.healthySamples = consecutive(
      healthSource,
      (o) =>
        o.health === "healthy" &&
        o.reachability === "reachable" &&
        o.auth !== "failed",
    );
    d.health =
      d.auth === "failed"
        ? "warning"
        : d.reachability === "unreachable"
          ? d.failures >= 3
            ? "offline"
            : "warning"
          : healthSource?.health === "error"
            ? "error"
            : healthSource?.health === "warning" || d.conflict
              ? "warning"
              : healthSource?.health === "healthy"
                ? "online"
                : "unknown";
  }
}
export function detect(s: State, now: number) {
  const faults = s.devices.filter(
    (d) =>
      d.health === "offline" ||
      d.health === "error" ||
      d.auth === "failed" ||
      d.conflict,
  );
  const grouped = new Set<string>();
  for (const d of faults) {
    if (grouped.has(d.id)) continue;
    const upstream = s.topology.find(
      (e) =>
        e.downstreamId === d.id &&
        s.devices.some((x) => x.id === e.upstreamId && x.health === "offline"),
    );
    const root = upstream
      ? s.devices.find((x) => x.id === upstream.upstreamId)!
      : d;
    const affected = [
      root.id,
      ...s.topology
        .filter(
          (e) =>
            e.upstreamId === root.id &&
            faults.some((f) => f.id === e.downstreamId),
        )
        .map((e) => e.downstreamId),
    ];
    affected.forEach((id) => grouped.add(id));
    const generation = root.collectorManaged ? 0 : s.generation;
    if (
      s.incidents.some(
        (i) =>
          i.generation === generation &&
          i.rootDeviceId === root.id &&
          (!["resolved", "cancelled"].includes(i.status) ||
            now - Date.parse(i.updatedAt) < 60000),
      )
    )
      continue;
    const i: Incident = {
      id: randomUUID(),
      summary: `Investigating ${root.name}`,
      cause: "Investigation pending",
      status: "detected",
      severity: affected.length > 1 ? "high" : "medium",
      deviceIds: affected,
      rootDeviceId: root.id,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      diagnosis: null,
      report: null,
      invocationId: null,
      verificationStartedAt: null,
      healthySamples: 0,
      generation,
    };
    s.incidents.push(i);
    event(s, "incident.detected", { affectedDevices: affected }, now, i.id);
  }
}
export function fixtureDiagnosis(s: State, i: Incident): Diagnosis {
  const root = s.devices.find((d) => d.id === i.rootDeviceId)!;
  const topic =
    root.auth === "failed"
      ? 2
      : root.conflict
        ? 3
        : root.kind === "switch"
          ? 0
          : root.kind === "service"
            ? 1
            : 5;
  const title = [
    "Upstream switch outage",
    "Telemetry service hung",
    "Authentication failure",
    "Conflicting sources",
    "Failed recovery",
    "Missing topology",
  ][topic];
  const book =
    s.runbooks.find((b) => b.title === title && b.published) ??
    s.runbooks.find((b) => b.published)!;
  const observations = i.deviceIds.flatMap((id) =>
    s.observations
      .filter((o) => o.deviceId === id)
      .toSorted((a, b) => a.observedAt.localeCompare(b.observedAt))
      .slice(-2),
  );
  const action =
    root.auth === "failed" || root.conflict
      ? null
      : root.kind === "switch"
        ? {
            name: "restart_switch" as const,
            targetDeviceId: root.id,
            arguments: {},
          }
        : root.kind === "service"
          ? {
              name: "restart_service" as const,
              targetDeviceId: root.id,
              arguments: {},
            }
          : null;
  return {
    summary: `${root.name}: ${book.title.toLowerCase()}`,
    cause:
      root.auth === "failed"
        ? "Credential-dependent monitoring failed; device reachability is a separate observation."
        : root.conflict
          ? "Sources disagree and include stale evidence."
          : root.kind === "switch"
            ? "Fresh switch failure and explicit dependencies support an upstream outage."
            : root.kind === "service"
              ? "The host responds while telemetry application health reports a hung service."
              : "Evidence is insufficient for a permitted recovery.",
    evidenceIds: [
      ...observations.map((o) => o.id),
      book.id,
      ...s.topology
        .filter((e) => i.deviceIds.includes(e.downstreamId))
        .map((e) => e.id),
    ],
    alternatives: [
      "A different underlying fault may require technician investigation.",
    ],
    uncertainty:
      "Deterministic fixture investigation; no language model was called.",
    action,
    provider: "fixture",
    modelId: "deterministic-fixture",
    usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
    toolCalls: 0,
  };
}
export function applyDiagnosis(
  s: State,
  i: Incident,
  input: unknown,
  now: number,
) {
  const d = DiagnosisSchema.parse(input);
  const valid = new Set([
    ...s.observations
      .filter((o) => i.deviceIds.includes(o.deviceId))
      .map((o) => o.id),
    ...s.runbooks.filter((b) => b.published).map((b) => b.id),
    ...s.topology
      .filter(
        (e) =>
          i.deviceIds.includes(e.upstreamId) ||
          i.deviceIds.includes(e.downstreamId),
      )
      .map((e) => e.id),
    `scenario-${s.generation}`,
  ]);
  if (d.evidenceIds.some((id) => !valid.has(id)))
    throw new Error("Unrecognized evidence reference");
  i.diagnosis = d;
  i.summary = d.summary;
  i.cause = d.cause;
  i.updatedAt = new Date(now).toISOString();
  event(
    s,
    "diagnosis.validated",
    {
      provider: d.provider,
      modelId: d.modelId,
      evidenceIds: d.evidenceIds,
      usage: d.usage,
    },
    now,
    i.id,
  );
  const action = d.action;
  const target = action
    ? s.devices.find((x) => x.id === action.targetDeviceId)
    : null;
  const readEvidence = d.evidenceIds.some((id) =>
    s.observations.some(
      (o) =>
        o.id === id &&
        o.deviceId === target?.id &&
        now - Date.parse(o.observedAt) <=
          3 * (target?.pollIntervalMs ?? 5000) &&
        o.auth !== "failed",
    ),
  );
  if (
    !action ||
    !target ||
    !i.deviceIds.includes(target.id) ||
    target.sourceMode !== "simulated" ||
    target.auth === "failed" ||
    target.conflict ||
    !readEvidence ||
    !(
      (action.name === "restart_switch" &&
        target.kind === "switch" &&
        target.health === "offline") ||
      (action.name === "restart_service" &&
        target.kind === "service" &&
        target.health === "error")
    )
  ) {
    i.status = "escalated";
    makeReport(
      s,
      i,
      now,
      "No authorized recovery with sufficient current evidence.",
    );
    return;
  }
  const p: Proposal = {
    id: randomUUID(),
    incidentId: i.id,
    name: action.name,
    targetDeviceId: target.id,
    risk: action.name === "restart_service" ? "automatic" : "approval_required",
    status: action.name === "restart_service" ? "approved" : "pending",
    hash: "",
    expiresAt: new Date(now + 30 * 60000).toISOString(),
    evidenceIds: d.evidenceIds,
    preconditions: {
      generation: i.generation,
      sourceMode: "simulated",
      kind: target.kind,
    },
    requesterId: null,
    approverId: null,
    reason:
      action.name === "restart_service"
        ? "Explicit simulator-only action policy"
        : "",
    requestedAt: new Date(now).toISOString(),
    policyVersion: POLICY_VERSION,
  };
  p.hash = proposalHash(p);
  s.approvals.push(p);
  i.status = p.status === "pending" ? "awaiting_approval" : "executing";
  event(
    s,
    p.status === "pending" ? "approval.required" : "policy.automatic",
    { proposalId: p.id, name: p.name, targetDeviceId: p.targetDeviceId },
    now,
    i.id,
  );
  if (p.status === "approved") queueCommand(s, p, now);
}
export function proposalHash(p: Proposal) {
  return stableHash({
    id: p.id,
    incidentId: p.incidentId,
    name: p.name,
    targetDeviceId: p.targetDeviceId,
    evidenceIds: p.evidenceIds,
    preconditions: p.preconditions,
    expiresAt: p.expiresAt,
    policyVersion: p.policyVersion,
  });
}
export function decide(
  s: State,
  p: Proposal,
  actor: { id: string; role: string },
  decision: "approved" | "rejected",
  hash: string,
  reason: string,
  now: number,
) {
  if (!MANAGER_ROLES.includes(actor.role))
    throw new Error("Manager role required");
  if (p.requesterId === actor.id) throw new Error("Self approval denied");
  if (
    p.status !== "pending" ||
    hash !== p.hash ||
    p.hash !== proposalHash(p) ||
    Date.parse(p.expiresAt) <= now
  )
    throw new Error("Approval is no longer valid");
  if (
    p.preconditions.generation !==
    (s.devices.find((d) => d.id === p.targetDeviceId)?.collectorManaged
      ? 0
      : s.generation)
  )
    throw new Error("State changed; new proposal required");
  p.status = decision;
  p.approverId = actor.id;
  p.reason = reason;
  p.decidedAt = new Date(now).toISOString();
  const i = s.incidents.find((i) => i.id === p.incidentId)!;
  i.updatedAt = new Date(now).toISOString();
  event(
    s,
    `approval.${decision}`,
    { proposalId: p.id, actorId: actor.id, reason },
    now,
    i.id,
  );
  if (decision === "approved") {
    i.status = "executing";
    queueCommand(s, p, now);
  } else {
    i.status = "escalated";
    makeReport(s, i, now, "Human rejected recovery.");
  }
}
function queueCommand(s: State, p: Proposal, now: number) {
  if (s.commands.some((c) => c.proposalId === p.id)) return;
  s.commands.push({
    id: randomUUID(),
    incidentId: p.incidentId,
    proposalId: p.id,
    deviceId: p.targetDeviceId,
    name: p.name,
    status: "queued",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(
      Math.min(Date.parse(p.expiresAt), now + 5 * 60000),
    ).toISOString(),
    executedAt: null,
    result: null,
  });
}
export function executeSimulator(s: State, now: number) {
  for (const c of s.commands.filter((c) => c.status === "queued")) {
    const p = s.approvals.find((p) => p.id === c.proposalId);
    const i = s.incidents.find((i) => i.id === c.incidentId);
    const d = s.devices.find((d) => d.id === c.deviceId);
    if (!i || !p || !d || d.collectorManaged) continue;
    if (
      p.status !== "approved" ||
      p.hash !== proposalHash(p) ||
      p.policyVersion !== POLICY_VERSION ||
      p.preconditions.generation !== s.generation ||
      d.sourceMode !== "simulated" ||
      Date.parse(c.expiresAt) <= now ||
      !d.observedAt ||
      now - Date.parse(d.observedAt) > 15000 ||
      d.auth === "failed" ||
      d.conflict ||
      (c.name === "restart_switch" &&
        (!p.approverId || d.health !== "offline")) ||
      (c.name === "restart_service" && d.health !== "error")
    ) {
      c.status = "failed";
      c.result = { reason: "Precondition or authorization changed" };
      i.status = "escalated";
      event(s, "action.blocked", { commandId: c.id }, now, i.id);
      makeReport(s, i, now, "Recovery blocked at execution.");
      continue;
    }
    c.status = "succeeded";
    c.executedAt = new Date(now).toISOString();
    c.result = { acknowledged: true, sourceMode: "simulated" };
    p.status = "executed";
    i.status = "verifying";
    i.verificationStartedAt = new Date(now).toISOString();
    i.healthySamples = 0;
    if (s.scenario !== "recovery_failure") s.scenario = "healthy";
    event(
      s,
      "action.executed",
      {
        commandId: c.id,
        name: c.name,
        targetDeviceId: c.deviceId,
        sourceMode: "simulated",
      },
      now,
      i.id,
    );
  }
}
export function verify(s: State, now: number) {
  for (const i of s.incidents) {
    if (i.status === "awaiting_approval") {
      const p = s.approvals.find(
        (p) => p.incidentId === i.id && p.status === "pending",
      );
      if (p && Date.parse(p.expiresAt) <= now) {
        p.status = "expired";
        i.status = "escalated";
        makeReport(s, i, now, "Approval expired.");
      }
    }
    if (i.status !== "verifying") continue;
    const counts = i.deviceIds.map((id) => {
      const d = s.devices.find((d) => d.id === id);
      if (
        !d ||
        d.health !== "online" ||
        d.conflict ||
        !d.observedAt ||
        now - Date.parse(d.observedAt) > 3 * (d.pollIntervalMs ?? 5000)
      )
        return 0;
      const samples = s.observations
        .filter(
          (o) =>
            o.deviceId === id &&
            o.health !== "unknown" &&
            Date.parse(o.observedAt) > Date.parse(i.verificationStartedAt!),
        )
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
      const times = new Set<string>();
      let count = 0;
      for (const o of samples) {
        if (times.has(o.observedAt)) continue;
        times.add(o.observedAt);
        if (
          o.health !== "healthy" ||
          o.reachability !== "reachable" ||
          o.auth === "failed"
        )
          break;
        if (++count === 3) break;
      }
      return count;
    });
    i.healthySamples = Math.min(...counts);
    const healthy = counts.length > 0 && i.healthySamples >= 3;
    if (healthy) {
      i.status = "resolved";
      i.updatedAt = new Date(now).toISOString();
      event(
        s,
        "incident.resolved",
        { verifiedDeviceIds: i.deviceIds },
        now,
        i.id,
      );
      makeReport(
        s,
        i,
        now,
        "Three consecutive fresh healthy observations confirm recovery.",
      );
    } else if (now - Date.parse(i.verificationStartedAt!) >= 120000) {
      i.status = "escalated";
      event(s, "verification.failed", {}, now, i.id);
      makeReport(
        s,
        i,
        now,
        "Recovery did not occur before verification timeout.",
      );
    }
  }
}
export function makeReport(
  s: State,
  i: Incident,
  now: number,
  outcome: string,
) {
  i.updatedAt = new Date(now).toISOString();
  const modes = new Set(
    s.devices
      .filter((d) => i.deviceIds.includes(d.id))
      .map((d) => d.sourceMode),
  );
  const approvalWaitMs = s.approvals
    .filter((p) => p.incidentId === i.id && p.risk === "approval_required")
    .reduce(
      (sum, p) =>
        sum +
        (p.requestedAt && p.decidedAt
          ? Math.max(0, Date.parse(p.decidedAt) - Date.parse(p.requestedAt))
          : 0),
      0,
    );
  const durationMs = now - Date.parse(i.createdAt);
  i.report = {
    title: i.summary,
    cause: i.cause,
    outcome,
    status: i.status,
    sourceMode: modes.size === 1 ? [...modes][0] : "mixed",
    provider: i.diagnosis?.provider ?? "none",
    createdAt: new Date(now).toISOString(),
    durationMs,
    approvalWaitMs,
    activeDurationMs: Math.max(0, durationMs - approvalWaitMs),
    evidence: s.observations.filter((o) =>
      i.diagnosis?.evidenceIds.includes(o.id),
    ),
    runbooks: s.runbooks
      .filter((b) => i.diagnosis?.evidenceIds.includes(b.id))
      .map(({ embedding, ...b }) => b),
    actions: s.commands.filter((c) => c.incidentId === i.id),
    publication: "draft",
  };
  event(s, "report.drafted", { outcome }, now, i.id);
}
