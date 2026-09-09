import { investigationMode as mode, liveProvider } from "./provider.js";
import { embedTexts, cosine, recoverEmbeddings } from "./embeddings.js";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { adminSql, withTenant, appendAuditEvent } from "@deviceops/db";
import type { SessionUser } from "@deviceops/contracts";
import {
  transaction,
  readState,
  saveState,
  eventsFor,
  budget,
  SERVICE_ID,
} from "./store.js";
import {
  type State,
  type Incident,
  ObservationSchema,
  ScenarioSchema,
  DiagnosisSchema,
  MANAGER_ROLES,
  createState,
  injectScenario,
  simulatorObservations,
  ingest,
  detect,
  fixtureDiagnosis,
  applyDiagnosis,
  executeSimulator,
  verify,
  decide,
  event,
  stableHash,
  fixedId,
  makeReport,
  proposalHash,
  POLICY_VERSION,
} from "./domain.js";
export * from "./domain.js";
export { eventsFor };
export { mode };
export class OpsError extends Error {
  override name = "DomainError";
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const manager = (actor: SessionUser) => {
  if (!MANAGER_ROLES.includes(actor.role))
    throw new OpsError(403, "ROLE_DENIED", "Manager role required");
};
function incidentView(s: State, i: Incident) {
  const ids = new Set(i.diagnosis?.evidenceIds ?? []);
  return {
    ...i,
    evidence: [
      ...s.observations
        .filter((o) => ids.has(o.id))
        .map((o) => ({ kind: "observation", ...o })),
      ...s.runbooks
        .filter((b) => ids.has(b.id))
        .map(({ embedding, ...b }) => ({ kind: "runbook", ...b })),
      ...s.topology
        .filter((e) => ids.has(e.id))
        .map((e) => ({ kind: "topology", ...e })),
    ],
  };
}
export async function getState(actor: SessionUser) {
  const s = await transaction(
    actor.tenantId,
    actor.id,
    (s) => {
      const { observations, runbooks, ...rest } = s;
      return {
        ...rest,
        incidents: s.incidents.map((i) => incidentView(s, i)),
        runbooks: runbooks.map(({ embedding, ...b }) => b),
      };
    },
    true,
  );
  const events = await withTenant(
    { tenantId: actor.tenantId, userId: actor.id },
    async (tx) =>
      (
        await tx`select id,incident_id as "incidentId",type,data,created_at as "createdAt",sequence::text from ops_events where tenant_id=${actor.tenantId} order by sequence desc limit 200`
      ).reverse(),
  );
  const notifications = await withTenant(
    { tenantId: actor.tenantId, userId: actor.id },
    (tx) =>
      tx`select id,incident_id as "incidentId",state,attempts,last_error as "lastError" from ops_notifications where tenant_id=${actor.tenantId} order by available_at desc limit 100`,
  );
  return { ...s, events, notifications, mode: mode(), budget: await budget() };
}
export async function listIncidents(actor: SessionUser) {
  return transaction(
    actor.tenantId,
    actor.id,
    (s) =>
      s.incidents
        .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50)
        .map(({ report, diagnosis, ...i }) => ({
          ...i,
          provider: diagnosis?.provider ?? null,
          hasReport: Boolean(report),
        })),
    true,
  );
}
export async function getIncident(actor: SessionUser, id: string) {
  z.uuid().parse(id);
  return transaction(
    actor.tenantId,
    actor.id,
    (s) => {
      const i = s.incidents.find((i) => i.id === id);
      if (!i) throw new OpsError(404, "NOT_FOUND", "Incident not found");
      return incidentView(s, i);
    },
    true,
  );
}
export async function mutate(
  actor: SessionUser,
  path: string,
  body: unknown,
  key: string,
) {
  if (!key || key.length > 160)
    throw new OpsError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "A bounded idempotency-key is required",
    );
  manager(actor);
  return transaction(actor.tenantId, actor.id, async (s, tx) => {
    const digest = stableHash({ path, body });
    const [previous] = await tx<
      Array<{ request_hash: string; response: unknown }>
    >`select request_hash,response from ops_requests where tenant_id=${actor.tenantId} and actor_id=${actor.id} and key=${key}`;
    if (previous) {
      if (previous.request_hash !== digest)
        throw new OpsError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Key already used for a different request",
        );
      return previous.response;
    }
    const now = Date.now();
    let response: Record<string, unknown> = { ok: true };
    if (path === "demo") {
      if (process.env.OPS_DEMO_ENABLED !== "true")
        throw new OpsError(403, "DEMO_DISABLED", "Demo controls are disabled");
      const { scenario } = z
        .object({ scenario: ScenarioSchema })
        .strict()
        .parse(body);
      const [recent] = await tx<
        Array<{ count: string }>
      >`select count(*)::text as count from ops_events where tenant_id=${actor.tenantId} and type='simulator.fault_injected' and created_at>now()-interval '1 minute'`;
      if (Number(recent?.count) > 5)
        throw new OpsError(
          429,
          "RATE_LIMITED",
          "Please wait before another scenario",
        );
      injectScenario(s, scenario, now);
      response = { ok: true, scenario: s.scenario };
    } else if (/^approvals\/[^/]+\/decision$/.test(path)) {
      const input = z
        .object({
          decision: z.enum(["approved", "rejected"]),
          proposalHash: z.string().length(64),
          reason: z.string().min(3).max(500),
        })
        .strict()
        .parse(body);
      const p = s.approvals.find((p) => p.id === path.split("/")[1]);
      if (!p) throw new OpsError(404, "NOT_FOUND", "Approval not found");
      try {
        decide(
          s,
          p,
          actor,
          input.decision,
          input.proposalHash,
          input.reason,
          now,
        );
      } catch (e) {
        throw new OpsError(
          409,
          "APPROVAL_INVALID",
          e instanceof Error ? e.message : "Approval rejected",
        );
      }
      await appendAuditEvent(tx, {
        tenantId: actor.tenantId,
        actorId: actor.id,
        action: `ops.approval.${input.decision}`,
        targetType: "ops_proposal",
        targetId: p.id,
        metadata: { proposalHash: p.hash, reason: input.reason },
      });
      response = { ok: true, incidentId: p.incidentId };
    } else if (path === "discovery") {
      z.object({ targets: z.literal("simulator") })
        .strict()
        .parse(body);
      if (!s.discovery.some((d) => d.address === "simulator://room-d"))
        s.discovery.push({
          id: randomUUID(),
          name: "Room D simulated display",
          address: "simulator://room-d",
          status: "candidate",
        });
      event(
        s,
        "discovery.completed",
        { candidates: s.discovery.length, sourceMode: "simulated" },
        now,
      );
      response = { candidates: s.discovery };
    } else if (/^discovery\/[^/]+\/enroll$/.test(path)) {
      z.object({}).strict().parse(body);
      const candidate = s.discovery.find((d) => d.id === path.split("/")[1]);
      if (!candidate)
        throw new OpsError(404, "NOT_FOUND", "Candidate not found");
      if (candidate.status === "candidate") {
        const base = s.devices.find((d) => d.kind === "display")!;
        s.devices.push({
          ...base,
          id: candidate.id,
          name: candidate.name,
          room: "Conference Room D",
          health: "unknown",
          observedAt: null,
          failures: 0,
          healthySamples: 0,
        });
        candidate.status = "enrolled";
        event(
          s,
          "discovery.enrolled",
          { deviceId: candidate.id, actorId: actor.id },
          now,
        );
      }
    } else if (/^incidents\/[^/]+\/publish-runbook$/.test(path)) {
      const input = z
        .object({
          title: z.string().min(5).max(160),
          text: z.string().min(40).max(12000),
        })
        .strict()
        .parse(body);
      const i = s.incidents.find((i) => i.id === path.split("/")[1]);
      if (!i?.report)
        throw new OpsError(
          409,
          "REPORT_REQUIRED",
          "A completed incident report is required",
        );
      if (i.report.publication === "published")
        throw new OpsError(
          409,
          "ALREADY_PUBLISHED",
          "This report has already been reviewed and published",
        );
      const id = randomUUID();
      s.runbooks.push({ id, ...input, version: "1", published: true });
      i.report.publication = "published";
      i.report.runbookId = id;
      event(
        s,
        "runbook.published",
        { runbookId: id, actorId: actor.id, version: "1" },
        now,
        i.id,
      );
      await appendAuditEvent(tx, {
        tenantId: actor.tenantId,
        actorId: actor.id,
        action: "ops.runbook.published",
        targetType: "ops_runbook",
        targetId: id,
        metadata: { incidentId: i.id, version: "1" },
      });
      response = { ok: true, runbookId: id };
    } else if (/^incidents\/[^/]+\/investigate$/.test(path)) {
      z.object({}).strict().parse(body);
      const i = s.incidents.find((i) => i.id === path.split("/")[1]);
      if (!i) throw new OpsError(404, "NOT_FOUND", "Incident not found");
      if (
        !["escalated", "detected"].includes(i.status) ||
        now - Date.parse(i.updatedAt) < 60000
      )
        throw new OpsError(
          409,
          "INVESTIGATION_COOLDOWN",
          "Wait for fresh evidence before investigating again",
        );
      // Previously attempted recoveries can be investigated again, but never automatically repeated.
      i.status = "detected";
      i.updatedAt = new Date(now).toISOString();
    } else throw new OpsError(404, "NOT_FOUND", "Operation not found");
    await tx`insert into ops_requests(tenant_id,actor_id,key,request_hash,response) values(${actor.tenantId},${actor.id},${key},${digest},${tx.json(response as postgres.JSONValue)})`;
    return response;
  });
}
export async function tickTenant(tenantId: string, now = Date.now()) {
  return transaction(tenantId, SERVICE_ID, async (s) => {
    if (
      now - Date.parse(s.lastPollAt) >=
      Number(process.env.OPS_POLL_MS ?? 5000)
    ) {
      ingest(s, simulatorObservations(s, now), now);
      s.lastPollAt = new Date(now).toISOString();
      detect(s, now);
    }
    for (const p of s.approvals.filter(
      (p) => p.status === "approved" && p.approverId,
    )) {
      const [membership] =
        await adminSql()`select role from memberships where tenant_id=${tenantId} and user_id=${p.approverId}`;
      if (!membership || !MANAGER_ROLES.includes(membership.role as string)) {
        p.status = "cancelled";
        event(s, "approval.revoked", { proposalId: p.id }, now, p.incidentId);
      }
    }
    executeSimulator(s, now);
    verify(s, now);
    for (const c of s.commands.filter(
      (c) => c.status === "running" && Date.parse(c.expiresAt) <= now,
    )) {
      c.status = "unknown";
      const i = s.incidents.find((i) => i.id === c.incidentId);
      if (i) {
        i.status = "escalated";
        makeReport(
          s,
          i,
          now,
          "Command result missing; outcome unknown and automatic replay blocked.",
        );
      }
    }

    return s.incidents.filter((i) => i.status === "detected").map((i) => i.id);
  });
}
export async function activeTenants() {
  return adminSql()<
    Array<{ tenant_id: string }>
  >`select tenant_id from ops_records where kind='meta'`;
}
export async function investigate(tenantId: string, incidentId: string) {
  if (mode() === "fixture") {
    await transaction(tenantId, SERVICE_ID, (s) => {
      const i = s.incidents.find((i) => i.id === incidentId);
      if (!i || i.status !== "detected") return;
      i.status = "investigating";
      event(
        s,
        "investigation.started",
        { provider: "fixture" },
        Date.now(),
        i.id,
      );
      const d = fixtureDiagnosis(s, i);
      if (s.commands.some((c) => c.incidentId === i.id)) d.action = null;
      applyDiagnosis(s, i, d, Date.now());
    });
    return;
  }
  const selected = liveProvider();
  if (
    !selected.confirmed ||
    !process.env.STRANDS_SERVICE_URL ||
    !process.env.STRANDS_SERVICE_TOKEN
  ) {
    await transaction(tenantId, SERVICE_ID, (s) => {
      const i = s.incidents.find((i) => i.id === incidentId);
      if (i?.status === "detected") {
        i.status = "escalated";
        i.cause =
          "Live investigation unavailable until provider usage and private Strands configuration are confirmed";
        makeReport(s, i, Date.now(), "Human review required.");
      }
    });
    return;
  }
  await budget();
  const token = randomBytes(32).toString("base64url");
  const invocationId = randomUUID();
  const { provider, reserve } = selected;
  const db = adminSql();
  const claimed = await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('deviceops:ops:invocation'))`;
    const [running] =
      await tx`select id from ops_invocations where status='running'`;
    if (running) return false;
    const [b] = await tx<
      Array<{ remaining: number }>
    >`select (limit_usd-spent_usd-reserved_usd)::float8 as remaining from ops_budget where id='bedrock' for update`;
    if (!b || b.remaining < reserve) {
      const s = await readState(tx, tenantId);
      const i = s.incidents.find((i) => i.id === incidentId);
      if (i?.status === "detected") {
        i.status = "escalated";
        i.cause = "Live model budget exhausted";
        event(s, "budget.exhausted", { kind: "model" }, Date.now(), i.id);
        makeReport(
          s,
          i,
          Date.now(),
          "Model budget exhausted; human review required.",
        );
        await saveState(tx, tenantId, s);
      }
      return false;
    }
    const s = await readState(tx, tenantId);
    const i = s.incidents.find((i) => i.id === incidentId);
    if (!i || i.status !== "detected") return false;
    i.status = "investigating";
    i.invocationId = invocationId;
    i.updatedAt = new Date().toISOString();
    event(
      s,
      "investigation.started",
      { provider, invocationId },
      Date.now(),
      i.id,
    );
    await tx`insert into ops_invocations(id,tenant_id,incident_id,status,grant_hash,expires_at,lease_until,reserved_usd) values(${invocationId},${tenantId},${incidentId},'running',${sha(token)},now()+interval '130 seconds',now()+interval '150 seconds',${reserve})`;
    await tx`update ops_budget set reserved_usd=reserved_usd+${reserve} where id='bedrock'`;
    await saveState(tx, tenantId, s);
    return true;
  });
  if (!claimed) return;
  try {
    const response = await fetch(
      `${process.env.STRANDS_SERVICE_URL}/investigate`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.STRANDS_SERVICE_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ invocationId, incidentId, grantToken: token }),
        signal: AbortSignal.timeout(125000),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const known = ["provider_rate_limited", "provider_model_unavailable", "provider_access_denied", "provider_invalid_request", "invalid_provider_result", "budget_exhausted", "invocation_timeout"];
      const detail = known.includes(body?.detail) ? body.detail : "provider_unavailable";
      throw new Error(`Strands service returned ${response.status}: ${detail}`);
    }
    const d = DiagnosisSchema.parse(await response.json());
    if (!selected.accepts(d))
      throw new Error("Unexpected model provider");
    const cost = selected.cost(d.usage);
    await completeInvocation(invocationId, tenantId, incidentId, cost, d, null);
  } catch (e) {
    await completeInvocation(
      invocationId,
      tenantId,
      incidentId,
      reserve,
      null,
      e instanceof Error ? e.message : "Investigation failed",
    );
  }
}
async function completeInvocation(
  id: string,
  tenant: string,
  incident: string,
  cost: number,
  diagnosis: z.infer<typeof DiagnosisSchema> | null,
  error: string | null,
) {
  await adminSql().begin(async (tx) => {
    const s = await readState(tx, tenant);
    const [inv] = await tx<
      Array<{ reserved_usd: string; status: string }>
    >`select reserved_usd,status from ops_invocations where id=${id} and tenant_id=${tenant} for update`;
    if (!inv || inv.status !== "running") return;
    const i = s.incidents.find((i) => i.id === incident);
    let failure = error;
    if (i?.status === "investigating" && i.invocationId === id) {
      if (diagnosis) {
        try {
          if (s.commands.some((c) => c.incidentId === i.id))
            diagnosis.action = null;
          applyDiagnosis(s, i, diagnosis, Date.now());
        } catch (e) {
          failure = e instanceof Error ? e.message : "Invalid diagnosis";
        }
      }
      if (failure) {
        i.status = "escalated";
        i.cause = failure;
        event(s, "investigation.failed", { error: failure }, Date.now(), i.id);
        makeReport(
          s,
          i,
          Date.now(),
          "Investigation unavailable; human review required.",
        );
      }
    }
    await tx`update ops_invocations set status=${failure ? "failed" : "completed"},completed_at=now(),error=${failure},cost_usd=${cost},input_tokens=${diagnosis?.usage.inputTokens ?? 0},output_tokens=${diagnosis?.usage.outputTokens ?? 0},model_calls=${diagnosis?.usage.modelCalls ?? 0} where id=${id}`;
    await tx`update ops_budget set reserved_usd=greatest(0,reserved_usd-${Number(inv.reserved_usd)}),spent_usd=spent_usd+${cost} where id='bedrock'`;
    await saveState(tx, tenant, s);
  });
}
export async function recoverInvocations() {
  await recoverEmbeddings();
  const expired = await adminSql()<
    Array<{
      id: string;
      tenant_id: string;
      incident_id: string;
      reserved_usd: string;
    }>
  >`select id,tenant_id,incident_id,reserved_usd from ops_invocations where status='running' and lease_until<now()`;
  for (const x of expired)
    await completeInvocation(
      x.id,
      x.tenant_id,
      x.incident_id,
      Number(x.reserved_usd),
      null,
      "Worker lease expired; reserved cost retained because model outcome is unknown",
    );
}
export async function callTool(grant: string, name: string, args: unknown) {
  const [inv] = await adminSql()<
    Array<{ id: string; tenant_id: string; incident_id: string }>
  >`update ops_invocations set tool_calls=tool_calls+1 where grant_hash=${sha(grant)} and status='running' and expires_at>now() and tool_calls<12 returning id,tenant_id,incident_id`;
  if (!inv)
    throw new OpsError(
      401,
      "INVALID_GRANT",
      "Expired or invalid investigation capability",
    );
  let queryEmbedding: number[] | null = null;
  if (name === "search_manual" && mode() === "bedrock") {
    const q = z
      .object({ query: z.string().min(3).max(4000) })
      .strict()
      .parse(args);
    const indexed = await transaction(inv.tenant_id, SERVICE_ID, (s) =>
      s.runbooks.some(
        (b) =>
          b.embeddingModel === "amazon.titan-embed-text-v2:0" &&
          b.embedding?.length === 1024,
      ),
    );
    if (indexed) {
      try {
        queryEmbedding =
          (await embedTexts([q.query], inv.tenant_id)).vectors[0] ?? null;
      } catch {
        queryEmbedding = null;
      }
    }
  }
  return transaction(inv.tenant_id, SERVICE_ID, async (s, tx) => {
    const [count] =
      await tx`select id from ops_invocations where id=${inv.id} and status='running' and expires_at>now()`;
    if (!count)
      throw new OpsError(429, "TOOL_BUDGET", "Tool grant budget exhausted");
    const i = s.incidents.find((i) => i.id === inv.incident_id);
    if (!i || i.status !== "investigating" || i.invocationId !== inv.id)
      throw new OpsError(
        403,
        "INCIDENT_SCOPE",
        "Incident no longer belongs to invocation",
      );
    const allowed = i.deviceIds;
    const input = z.record(z.string(), z.unknown()).parse(args);
    let result: unknown;
    const scoped = () => {
      const id =
        input.deviceId === undefined
          ? i.rootDeviceId
          : z.uuid().parse(input.deviceId);
      if (!allowed.includes(id))
        throw new OpsError(
          403,
          "DEVICE_SCOPE",
          "Device outside incident scope",
        );
      return id;
    };
    if (name === "get_incident_context") {
      z.object({}).strict().parse(input);
      result = {
        incident: i,
        devices: s.devices.filter((d) => allowed.includes(d.id)),
      };
    } else if (name === "get_device_health") {
      z.object({ deviceId: z.uuid().optional() }).strict().parse(input);
      result = {
        device: s.devices.find((d) => d.id === scoped()),
        observations: s.observations
          .filter((o) => o.deviceId === scoped())
          .slice(-8),
      };
    } else if (name === "query_telemetry_logs") {
      z.object({ deviceId: z.uuid().optional() }).strict().parse(input);
      result = {
        observations: s.observations
          .filter((o) => o.deviceId === scoped())
          .slice(-30),
      };
    } else if (name === "get_topology") {
      z.object({}).strict().parse(input);
      result = {
        relationships: s.topology.filter(
          (e) =>
            allowed.includes(e.upstreamId) && allowed.includes(e.downstreamId),
        ),
      };
    } else if (name === "search_manual") {
      const { query } = z
        .object({ query: z.string().min(3).max(4000) })
        .strict()
        .parse(input);
      const words = query
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2);
      const lexical = s.runbooks
        .filter((b) => b.published)
        .map((b) => ({
          ...b,
          score: words.filter((w) =>
            `${b.title} ${b.text}`.toLowerCase().includes(w),
          ).length,
        }))
        .sort((a, b) => b.score - a.score);
      const semantic = queryEmbedding
        ? s.runbooks
            .filter(
              (b) =>
                b.published &&
                b.embeddingModel === "amazon.titan-embed-text-v2:0" &&
                b.embedding?.length === 1024,
            )
            .map((b) => ({
              ...b,
              score: cosine(queryEmbedding!, b.embedding!),
            }))
            .sort((a, b) => b.score - a.score)
        : [];
      const ranked = lexical
        .map((b, n) => ({
          ...b,
          score:
            1 / (60 + n + 1) +
            (semantic.some((x) => x.id === b.id)
              ? 1 / (60 + semantic.findIndex((x) => x.id === b.id) + 1)
              : 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      result = {
        retrievalMode: queryEmbedding ? "semantic-plus-lexical-rrf" : "lexical",
        results: ranked.map(({ embedding, ...b }) => b),
      };
    } else if (name === "correlate_changes") {
      z.object({}).strict().parse(input);
      result = {
        changes: [
          {
            id: `scenario-${s.generation}`,
            occurredAt: s.scenarioStartedAt,
            summary:
              "A simulator fault was injected; this is test provenance, not the diagnosis.",
          },
        ],
      };
    } else if (name === "get_action_capabilities") {
      z.object({ deviceId: z.uuid().optional() }).strict().parse(input);
      const d = s.devices.find((d) => d.id === scoped())!;
      result = {
        deviceId: d.id,
        actions:
          d.sourceMode === "simulated" && d.kind === "switch"
            ? [
                {
                  name: "restart_switch",
                  arguments: {},
                  approvalRequired: true,
                },
              ]
            : d.sourceMode === "simulated" && d.kind === "service"
              ? [
                  {
                    name: "restart_service",
                    arguments: {},
                    approvalRequired: false,
                  },
                ]
              : [],
      };
    } else throw new OpsError(403, "TOOL_DENIED", "Unknown tool");
    event(
      s,
      "tool.completed",
      { invocationId: inv.id, tool: name, arguments: input, result },
      Date.now(),
      i.id,
    );
    return result;
  });
}
export async function collectorContext(token: string) {
  const [c] = await adminSql()<
    Array<{
      id: string;
      tenant_id: string;
      device_ids: string[];
      source_mode: "simulated" | "live";
    }>
  >`select id,tenant_id,device_ids,source_mode from ops_collectors where token_hash=${sha(token)} and revoked_at is null and expires_at>now()`;
  if (!c)
    throw new OpsError(
      401,
      "COLLECTOR_UNAUTHORIZED",
      "Invalid collector credential",
    );
  return c;
}
export async function collectorRequest(
  token: string,
  path: string,
  body: unknown,
) {
  const c = await collectorContext(token);
  return transaction(c.tenant_id, SERVICE_ID, async (s, tx) => {
    await tx`update ops_collectors set last_seen_at=now() where id=${c.id}`;
    if (path === "heartbeat") return { ok: true };
    if (path === "observations") {
      const { observations } = z
        .object({ observations: z.array(ObservationSchema).min(1).max(100) })
        .strict()
        .parse(body);
      if (
        observations.some(
          (o) =>
            !c.device_ids.includes(o.deviceId) ||
            o.sourceMode !== c.source_mode,
        )
      )
        throw new OpsError(
          403,
          "DEVICE_SCOPE",
          "Observation outside collector enrollment",
        );
      ingest(s, observations, Date.now());
      detect(s, Date.now());
      return { accepted: observations.length };
    }
    if (path === "commands") {
      const commands = [];
      const now = Date.now();
      for (const cmd of s.commands.filter(
        (x) => c.device_ids.includes(x.deviceId) && x.status === "queued",
      )) {
        const p = s.approvals.find((p) => p.id === cmd.proposalId);
        const d = s.devices.find((d) => d.id === cmd.deviceId);
        const i = s.incidents.find((i) => i.id === cmd.incidentId);
        if (
          !p ||
          !d ||
          !i ||
          !d.collectorManaged ||
          d.sourceMode !== "simulated" ||
          c.source_mode !== "simulated" ||
          p.status !== "approved" ||
          p.hash !== proposalHash(p) ||
          p.policyVersion !== POLICY_VERSION ||
          p.preconditions.generation !==
            (d.collectorManaged ? 0 : s.generation) ||
          Date.parse(cmd.expiresAt) <= now ||
          !d.observedAt ||
          now - Date.parse(d.observedAt) > 3 * (d.pollIntervalMs ?? 30000) ||
          d.auth === "failed" ||
          d.conflict ||
          (cmd.name === "restart_switch" &&
            (!p.approverId || d.health !== "offline")) ||
          (cmd.name === "restart_service" && d.health !== "error")
        ) {
          cmd.status = "failed";
          if (i) {
            i.status = "escalated";
            event(s, "action.blocked", { commandId: cmd.id }, now, i.id);
            makeReport(s, i, now, "Collector command precondition failed.");
          }
          continue;
        }
        if (p.approverId) {
          const [membership] =
            await tx`select role from memberships where tenant_id=${c.tenant_id} and user_id=${p.approverId}`;
          if (
            !membership ||
            !MANAGER_ROLES.includes(membership.role as string)
          ) {
            p.status = "cancelled";
            cmd.status = "failed";
            i.status = "escalated";
            event(s, "approval.revoked", { proposalId: p.id }, now, i.id);
            makeReport(s, i, now, "Approver no longer holds a manager role.");
            continue;
          }
        }
        cmd.status = "running";
        event(
          s,
          "action.dispatched",
          { commandId: cmd.id, collectorId: c.id },
          now,
          i.id,
        );
        commands.push({ ...cmd, sourceMode: "simulated", arguments: {} });
      }
      return { commands };
    }
    if (/^commands\/[^/]+\/result$/.test(path)) {
      const input = z
        .object({
          status: z.enum(["completed", "failed", "unknown"]),
          deviceId: z.uuid(),
          commandId: z.uuid(),
        })
        .passthrough()
        .parse(body);
      const cmd = s.commands.find((x) => x.id === path.split("/")[1]);
      if (
        !cmd ||
        !c.device_ids.includes(cmd.deviceId) ||
        input.deviceId !== cmd.deviceId ||
        input.commandId !== cmd.id
      )
        throw new OpsError(
          403,
          "COMMAND_SCOPE",
          "Command outside collector scope",
        );
      if (["succeeded", "failed", "unknown"].includes(cmd.status))
        return { ok: true };
      if (cmd.status !== "running")
        throw new OpsError(
          409,
          "COMMAND_NOT_CLAIMED",
          "Command was not dispatched to the collector",
        );
      cmd.status = input.status === "completed" ? "succeeded" : input.status;
      cmd.executedAt = new Date().toISOString();
      cmd.result = { status: input.status };
      const i = s.incidents.find((i) => i.id === cmd.incidentId)!;
      const p = s.approvals.find((p) => p.id === cmd.proposalId)!;
      if (cmd.status === "succeeded") {
        p.status = "executed";
        i.status = "verifying";
        i.verificationStartedAt = cmd.executedAt;
        event(
          s,
          "action.executed",
          { commandId: cmd.id, collectorId: c.id },
          Date.now(),
          i.id,
        );
      } else {
        i.status = "escalated";
        makeReport(
          s,
          i,
          Date.now(),
          "Collector execution failed or its outcome is unknown.",
        );
      }
      return { ok: true };
    }
    throw new OpsError(404, "NOT_FOUND", "Collector endpoint not found");
  });
}
export async function enrollCollector(actor: SessionUser, body: unknown) {
  manager(actor);
  const input = z
    .object({
      devices: z
        .array(
          z
            .object({
              name: z.string().min(1).max(120),
              room: z.string().min(1).max(120),
              kind: z.string().min(1).max(50),
            })
            .strict(),
        )
        .min(1)
        .max(64),
      sourceMode: z.enum(["simulated", "live"]),
    })
    .strict()
    .parse(body);
  const token = randomBytes(32).toString("base64url");
  return transaction(actor.tenantId, actor.id, async (s, tx) => {
    const ids = input.devices.map((d) => {
      const id = randomUUID();
      s.devices.push({
        id,
        ...d,
        sourceMode: input.sourceMode,
        health: "unknown",
        reachability: "unknown",
        auth: "unknown",
        observedAt: null,
        conflict: false,
        metrics: {},
        collectorManaged: true,
        pollIntervalMs: 30000,
        failures: 0,
        healthySamples: 0,
      });
      return id;
    });
    const id = randomUUID();
    await tx`insert into ops_collectors(id,tenant_id,token_hash,device_ids,source_mode,expires_at) values(${id},${actor.tenantId},${sha(token)},${ids},${input.sourceMode},now()+interval '7 days')`;
    return { collectorId: id, token, deviceIds: ids, expiresInDays: 7 };
  });
}
export {
  dispatchNotifications,
  claimNotification,
  acknowledgeNotification,
} from "./notifications.js";

export async function reindexRunbooks(actor: SessionUser) {
  manager(actor);
  const books = await transaction(actor.tenantId, actor.id, (s) =>
    s.runbooks
      .filter((b) => b.published)
      .map((b) => ({ id: b.id, text: b.text, version: b.version })),
  );
  let count = 0;
  for (let start = 0; start < books.length; start += 16) {
    const batch = books.slice(start, start + 16);
    const result = await embedTexts(
      batch.map((b) => b.text.slice(0, 4000)),
      actor.tenantId,
    );
    count += await transaction(actor.tenantId, actor.id, (s) => {
      let indexed = 0;
      for (let n = 0; n < batch.length; n++) {
        const b = s.runbooks.find((b) => b.id === batch[n]!.id);
        if (b && b.version === batch[n]!.version) {
          b.embedding = result.vectors[n]!;
          b.embeddingModel = result.modelId;
          indexed++;
        }
      }
      event(
        s,
        "runbooks.indexed",
        { count: indexed, modelId: result.modelId },
        Date.now(),
      );
      return indexed;
    });
  }
  return {
    indexed: count,
    modelId: "amazon.titan-embed-text-v2:0",
    maxCharactersPerRunbook: 4000,
  };
}
