import { createHash, randomUUID } from "node:crypto";
import { createAiProvider, type AiProvider } from "@deviceops/ai";
import {
  DeviceStatusSchema,
  SafeDiagnosisSchema,
  contractHash,
  stableJson,
  type CreateRunRequest,
  type DeviceStatus,
  type RunEvent,
  type RunState,
  type SafeDiagnosis,
  type SessionUser
} from "@deviceops/contracts";
import {
  appendAuditEvent,
  appendRunEvent,
  vectorLiteral,
  withTenant
} from "@deviceops/db";
import { logStructured, metrics } from "@deviceops/observability";
import { POLICY_VERSION, PolicyError, assertCanApprove, hasMinimumRole } from "@deviceops/policy";
import {
  detectPromptInjection,
  deterministicEmbedding,
  reciprocalRankFusion,
  type SearchResult
} from "@deviceops/retrieval";
import postgres from "postgres";

const RUN_ROUTE = "/api/v1/runs";
const RUN_TTL_MS = 15 * 60 * 1000;
const APPROVAL_TTL_MS = 30 * 60 * 1000;

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export interface RunSummary {
  id: string;
  state: RunState;
  question: string;
  roomName: string;
  deviceName: string;
  diagnosis: SafeDiagnosis | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export async function createRun(input: {
  actor: SessionUser;
  request: CreateRunRequest;
  idempotencyKey: string;
  correlationId: string;
}): Promise<{ runId: string; status: "queued"; eventsUrl: string }> {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(input.idempotencyKey)) {
    throw new DomainError("INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key is required", 400);
  }
  const requestHash = createHash("sha256")
    .update(stableJson(input.request))
    .digest("hex");
  return withTenant(
    { tenantId: input.actor.tenantId, userId: input.actor.id },
    async (transaction) => {
      const [existing] = await transaction<
        Array<{ request_hash: string; response_status: number | null; response_body: unknown }>
      >`
        select request_hash, response_status, response_body
        from idempotency_keys
        where tenant_id = ${input.actor.tenantId}
          and actor_id = ${input.actor.id}
          and route = ${RUN_ROUTE}
          and key = ${input.idempotencyKey}
          and expires_at > now()
        for update
      `;
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "This Idempotency-Key was already used with a different request",
            409
          );
        }
        if (existing.response_status === 202 && existing.response_body) {
          return existing.response_body as {
            runId: string;
            status: "queued";
            eventsUrl: string;
          };
        }
      }

      const [device] = await transaction<Array<{ id: string }>>`
        select id from devices
        where tenant_id = ${input.actor.tenantId}
          and room_id = ${input.request.roomId}
          and id = ${input.request.deviceId}
      `;
      if (!device) {
        throw new DomainError("DEVICE_NOT_FOUND", "The device is not available in this room", 404);
      }

      if (input.request.mediaIds.length > 0) {
        const media = await transaction<Array<{ id: string }>>`
          select id from media_assets
          where tenant_id = ${input.actor.tenantId}
            and owner_id = ${input.actor.id}
            and state = 'ready'
            and id in ${transaction(input.request.mediaIds)}
        `;
        if (media.length !== input.request.mediaIds.length) {
          throw new DomainError("MEDIA_NOT_READY", "Every attached media item must be owned and ready", 409);
        }
      }

      const runId = randomUUID();
      const expiresAt = new Date(Date.now() + RUN_TTL_MS).toISOString();
      const response = {
        runId,
        status: "queued" as const,
        eventsUrl: `/api/v1/runs/${runId}/events`
      };
      await transaction`
        insert into assistant_runs
          (id, tenant_id, requester_id, room_id, device_id, state, question, correlation_id, expires_at)
        values
          (${runId}, ${input.actor.tenantId}, ${input.actor.id}, ${input.request.roomId},
           ${input.request.deviceId}, 'queued', ${input.request.question}, ${input.correlationId}, ${expiresAt})
      `;
      await transaction`
        insert into run_messages (id, tenant_id, run_id, role, content)
        values (${randomUUID()}, ${input.actor.tenantId}, ${runId}, 'user', ${input.request.question})
      `;
      if (input.request.mediaIds.length > 0) {
        await transaction`
          update media_assets set run_id = ${runId}, state = 'attached', updated_at = now()
          where tenant_id = ${input.actor.tenantId}
            and owner_id = ${input.actor.id}
            and id in ${transaction(input.request.mediaIds)}
        `;
      }
      await appendRunEvent(transaction, {
        tenantId: input.actor.tenantId,
        runId,
        type: "run.accepted",
        correlationId: input.correlationId,
        data: { mediaCount: input.request.mediaIds.length }
      });
      await appendAuditEvent(transaction, {
        tenantId: input.actor.tenantId,
        actorId: input.actor.id,
        action: "assistant_run.created",
        targetType: "assistant_run",
        targetId: runId,
        metadata: { roomId: input.request.roomId, deviceId: input.request.deviceId }
      });
      await transaction`
        insert into idempotency_keys
          (tenant_id, actor_id, route, key, request_hash, response_status, response_body, expires_at)
        values
          (${input.actor.tenantId}, ${input.actor.id}, ${RUN_ROUTE}, ${input.idempotencyKey},
           ${requestHash}, 202, ${transaction.json(response as unknown as postgres.JSONValue)}, ${expiresAt})
      `;
      await transaction`
        insert into outbox_events
          (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
        values
          (${randomUUID()}, ${input.actor.tenantId}, 'assistant_run', ${runId}, 'run.requested',
           ${transaction.json({ runId, tenantId: input.actor.tenantId, requesterId: input.actor.id, correlationId: input.correlationId } as postgres.JSONValue)})
      `;
      return response;
    }
  );
}

export async function listRuns(actor: SessionUser, limit = 20): Promise<RunSummary[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  return withTenant({ tenantId: actor.tenantId, userId: actor.id }, async (transaction) => {
    const rows = await transaction<
      Array<{
        id: string;
        state: RunState;
        question: string;
        room_name: string;
        device_name: string;
        diagnosis: unknown;
        correlation_id: string;
        created_at: string;
        updated_at: string;
      }>
    >`
      select r.id, r.state, r.question, rm.name as room_name, d.name as device_name,
             r.diagnosis, r.correlation_id, r.created_at, r.updated_at
      from assistant_runs r
      join rooms rm on rm.id = r.room_id
      join devices d on d.id = r.device_id
      where r.tenant_id = ${actor.tenantId}
      order by r.created_at desc
      limit ${boundedLimit}
    `;
    return rows.map(mapRunSummary);
  });
}

export async function getRun(actor: SessionUser, runId: string): Promise<RunSummary> {
  return withTenant({ tenantId: actor.tenantId, userId: actor.id }, async (transaction) => {
    const [row] = await transaction<
      Array<{
        id: string;
        state: RunState;
        question: string;
        room_name: string;
        device_name: string;
        diagnosis: unknown;
        correlation_id: string;
        created_at: string;
        updated_at: string;
      }>
    >`
      select r.id, r.state, r.question, rm.name as room_name, d.name as device_name,
             r.diagnosis, r.correlation_id, r.created_at, r.updated_at
      from assistant_runs r
      join rooms rm on rm.id = r.room_id
      join devices d on d.id = r.device_id
      where r.tenant_id = ${actor.tenantId} and r.id = ${runId}
    `;
    if (!row) throw new DomainError("RUN_NOT_FOUND", "Run not found", 404);
    return mapRunSummary(row);
  });
}

export async function getRunEvents(
  actor: SessionUser,
  runId: string,
  afterSequence = 0n
): Promise<RunEvent[]> {
  return withTenant({ tenantId: actor.tenantId, userId: actor.id }, async (transaction) => {
    const [run] = await transaction<Array<{ id: string }>>`
      select id from assistant_runs where tenant_id = ${actor.tenantId} and id = ${runId}
    `;
    if (!run) throw new DomainError("RUN_NOT_FOUND", "Run not found", 404);
    const rows = await transaction<
      Array<{
        id: string;
        run_id: string;
        sequence: string;
        type: RunEvent["type"];
        occurred_at: string;
        correlation_id: string;
        data: Record<string, unknown>;
      }>
    >`
      select id, run_id, sequence::text, type, occurred_at, correlation_id, data
      from run_events
      where tenant_id = ${actor.tenantId}
        and run_id = ${runId}
        and sequence > ${afterSequence.toString()}::bigint
      order by sequence asc
      limit 500
    `;
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      occurredAt: new Date(row.occurred_at).toISOString(),
      correlationId: row.correlation_id,
      data: row.data
    }));
  });
}

export async function getDeviceStatus(
  actor: SessionUser,
  roomId: string,
  deviceId: string
): Promise<DeviceStatus> {
  return withTenant({ tenantId: actor.tenantId, userId: actor.id }, async (transaction) => {
    const [row] = await transaction<Array<{ payload: unknown; observed_at: string }>>`
      select s.payload, s.observed_at
      from device_status_snapshots s
      join devices d on d.id = s.device_id and d.tenant_id = s.tenant_id
      where s.tenant_id = ${actor.tenantId}
        and d.room_id = ${roomId}
        and d.id = ${deviceId}
      order by s.observed_at desc
      limit 1
    `;
    if (!row) throw new DomainError("STATUS_NOT_FOUND", "No device status is available", 404);
    return DeviceStatusSchema.parse({
      ...(row.payload as Record<string, unknown>),
      deviceId,
      observedAt: new Date(row.observed_at).toISOString(),
      simulated: true
    });
  });
}

export async function processRun(
  input: { tenantId: string; requesterId: string; runId: string },
  provider: AiProvider = createAiProvider()
): Promise<"completed" | "awaiting_approval" | "skipped"> {
  const claimed = await withTenant(
    { tenantId: input.tenantId, userId: input.requesterId },
    async (transaction) => {
      const [run] = await transaction<
        Array<{
          id: string;
          tenant_id: string;
          requester_id: string;
          room_id: string;
          device_id: string;
          question: string;
          correlation_id: string;
          email: string;
          display_name: string;
          tenant_name: string;
          role: SessionUser["role"];
          demo_mode: boolean;
        }>
      >`
        update assistant_runs r
        set state = 'running', started_at = coalesce(started_at, now()), updated_at = now()
        from users u, memberships m, tenants t
        where r.id = ${input.runId}
          and r.tenant_id = ${input.tenantId}
          and r.requester_id = ${input.requesterId}
          and r.state = 'queued'
          and r.expires_at > now()
          and u.id = r.requester_id
          and m.user_id = u.id and m.tenant_id = r.tenant_id
          and t.id = r.tenant_id
        returning r.id, r.tenant_id, r.requester_id, r.room_id, r.device_id,
                  r.question, r.correlation_id, u.email, u.display_name,
                  t.name as tenant_name, m.role, t.demo_mode
      `;
      if (!run) return null;
      await appendRunEvent(transaction, {
        tenantId: input.tenantId,
        runId: input.runId,
        type: "run.started",
        correlationId: run.correlation_id,
        data: { provider: provider.name }
      });
      return run;
    }
  );
  if (!claimed) return "skipped";

  const actor: SessionUser = {
    id: claimed.requester_id,
    email: claimed.email,
    displayName: claimed.display_name,
    tenantId: claimed.tenant_id,
    tenantName: claimed.tenant_name,
    role: claimed.role,
    demoMode: claimed.demo_mode
  };
  const started = performance.now();
  try {
    const result = await provider.diagnose({
      actor,
      run: {
        id: claimed.id,
        tenantId: claimed.tenant_id,
        roomId: claimed.room_id,
        deviceId: claimed.device_id
      },
      question: claimed.question,
      limits: {
        maxTurns: boundedInteger("AI_MAX_TURNS", 6, 1, 6),
        maxToolCalls: boundedInteger("AI_MAX_TOOL_CALLS", 4, 1, 4),
        maxCostUsd: boundedNumber("AI_MAX_COST_USD", 0.1, 0, 10)
      },
      searchManual: async ({ query }) => searchManual(actor, query),
      getDeviceStatus: async ({ roomId, deviceId }) => getDeviceStatus(actor, roomId, deviceId)
    });
    const diagnosis = SafeDiagnosisSchema.parse(result.diagnosis);
    const finalState = diagnosis.serverDecision.requiresApproval
      ? "awaiting_approval"
      : "completed";
    await persistDiagnosis({
      actor,
      runId: claimed.id,
      correlationId: claimed.correlation_id,
      diagnosis,
      retrieved: result.retrieved,
      usage: result.usage,
      latencyMs: Math.round(performance.now() - started),
      finalState
    });
    metrics.increment("deviceops_runs_total", { state: finalState, provider: provider.name });
    return finalState;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown run processing error";
    await withTenant({ tenantId: actor.tenantId, userId: actor.id }, async (transaction) => {
      await transaction`
        update assistant_runs
        set state = 'failed', error_code = 'RUN_PROCESSING_FAILED',
            error_detail = ${message.slice(0, 500)}, completed_at = now(), updated_at = now()
        where tenant_id = ${actor.tenantId} and id = ${claimed.id} and state = 'running'
      `;
      await appendRunEvent(transaction, {
        tenantId: actor.tenantId,
        runId: claimed.id,
        type: "run.failed",
        correlationId: claimed.correlation_id,
        data: { code: "RUN_PROCESSING_FAILED", retryable: true }
      });
      await appendAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorId: actor.id,
        action: "assistant_run.failed",
        targetType: "assistant_run",
        targetId: claimed.id,
        metadata: { code: "RUN_PROCESSING_FAILED" }
      });
    });
    logStructured("run.processing.failed", {
      tenantId: actor.tenantId,
      runId: claimed.id,
      error: message
    }, "error");
    throw error;
  }
}

export async function resetRunForRetry(input: {
  tenantId: string;
  requesterId: string;
  runId: string;
  retryCount: number;
}): Promise<boolean> {
  return withTenant({ tenantId: input.tenantId, userId: input.requesterId }, async (transaction) => {
    const [run] = await transaction<Array<{ correlation_id: string }>>`
      update assistant_runs
      set state = 'queued', error_code = null, error_detail = null, updated_at = now()
      where tenant_id = ${input.tenantId} and requester_id = ${input.requesterId}
        and id = ${input.runId} and state = 'failed' and expires_at > now()
      returning correlation_id
    `;
    if (!run) return false;
    await appendRunEvent(transaction, {
      tenantId: input.tenantId,
      runId: input.runId,
      type: "run.accepted",
      correlationId: run.correlation_id,
      data: { retryCount: input.retryCount, recovered: true }
    });
    await appendAuditEvent(transaction, {
      tenantId: input.tenantId,
      actorId: input.requesterId,
      action: "assistant_run.retry_scheduled",
      targetType: "assistant_run",
      targetId: input.runId,
      metadata: { retryCount: input.retryCount }
    });
    return true;
  });
}

export async function decideApproval(input: {
  actor: SessionUser;
  approvalId: string;
  decision: "approved" | "denied";
  reason: string;
  proposalHash: string;
}): Promise<{ approvalId: string; state: "approved" | "denied"; incidentId: string | null }> {
  return withTenant({ tenantId: input.actor.tenantId, userId: input.actor.id }, async (transaction) => {
    const [approval] = await transaction<
      Array<{
        id: string;
        run_id: string;
        requester_id: string;
        tenant_id: string;
        proposal: Record<string, unknown>;
        proposal_hash: string;
        state: string;
      }>
    >`
      select id, run_id, requester_id, tenant_id, proposal, proposal_hash, state
      from approval_requests
      where tenant_id = ${input.actor.tenantId} and id = ${input.approvalId}
      for update
    `;
    if (!approval) throw new DomainError("APPROVAL_NOT_FOUND", "Approval request not found", 404);
    try {
      assertCanApprove(input.actor, approval.requester_id, approval.tenant_id);
    } catch (error) {
      if (error instanceof PolicyError) {
        throw new DomainError(error.code, error.message, 403);
      }
      throw error;
    }
    if (approval.state !== "pending") {
      throw new DomainError("APPROVAL_ALREADY_DECIDED", "Approval is no longer pending", 409);
    }
    if (approval.proposal_hash !== input.proposalHash) {
      throw new DomainError("PROPOSAL_CHANGED", "The proposal hash does not match", 409);
    }
    const [updated] = await transaction<Array<{ id: string }>>`
      update approval_requests
      set state = ${input.decision}, decided_by = ${input.actor.id},
          decision_reason = ${input.reason}, decided_at = now()
      where tenant_id = ${input.actor.tenantId}
        and id = ${approval.id}
        and state = 'pending'
        and expires_at > now()
      returning id
    `;
    if (!updated) throw new DomainError("APPROVAL_EXPIRED", "Approval expired or was already decided", 409);

    let incidentId: string | null = null;
    if (input.decision === "approved") {
      incidentId = randomUUID();
      const commandKey = `${input.actor.tenantId}:${approval.run_id}:${approval.proposal_hash}`;
      await transaction`
        insert into incidents
          (id, tenant_id, run_id, approval_id, state, command_key, summary, assigned_team)
        values
          (${incidentId}, ${input.actor.tenantId}, ${approval.run_id}, ${approval.id},
           'approved', ${commandKey}, ${String(approval.proposal.summary ?? "DeviceOps incident")}, 'Synthetic Support Team')
        on conflict (command_key) do nothing
      `;
      const [incident] = await transaction<Array<{ id: string }>>`
        select id from incidents where command_key = ${commandKey}
      `;
      incidentId = incident?.id ?? incidentId;
      await transaction`
        insert into outbox_events
          (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
        values
          (${randomUUID()}, ${input.actor.tenantId}, 'incident', ${incidentId}, 'incident.approved',
           ${transaction.json({ incidentId, runId: approval.run_id } as postgres.JSONValue)})
      `;
    }
    await transaction`
      update assistant_runs set state = 'completed', completed_at = now(), updated_at = now()
      where tenant_id = ${input.actor.tenantId} and id = ${approval.run_id} and state = 'awaiting_approval'
    `;
    await appendAuditEvent(transaction, {
      tenantId: input.actor.tenantId,
      actorId: input.actor.id,
      action: `approval.${input.decision}`,
      targetType: "approval_request",
      targetId: approval.id,
      metadata: { proposalHash: approval.proposal_hash, incidentId }
    });
    return { approvalId: approval.id, state: input.decision, incidentId };
  });
}

export async function retryIncident(input: { actor: SessionUser; incidentId: string }): Promise<{ incidentId: string; state: 'retrying'; attempt: number }> {
  if (!hasMinimumRole(input.actor.role, 'manager')) throw new DomainError('INCIDENT_RETRY_DENIED', 'Manager role is required', 403);
  return withTenant({ tenantId: input.actor.tenantId, userId: input.actor.id }, async (transaction) => {
    const [incident] = await transaction<Array<{ id: string; state: string }>>`
      select id, state from incidents where tenant_id = ${input.actor.tenantId} and id = ${input.incidentId} for update
    `;
    if (!incident) throw new DomainError('INCIDENT_NOT_FOUND', 'Incident not found', 404);
    if (!['dead_lettered', 'retrying'].includes(incident.state)) throw new DomainError('INCIDENT_NOT_RETRYABLE', 'Incident is not in a retryable state', 409);
    const [attempt] = await transaction<Array<{ attempt: number }>>`select coalesce(max(attempt), 0) + 1 as attempt from incident_attempts where tenant_id = ${input.actor.tenantId} and incident_id = ${incident.id}`;
    const nextAttempt = Number(attempt?.attempt ?? 1);
    await transaction`update incidents set state = 'retrying', updated_at = now(), last_error = null where tenant_id = ${input.actor.tenantId} and id = ${incident.id}`;
    await transaction`insert into incident_attempts (id, tenant_id, incident_id, attempt, status) values (${randomUUID()}, ${input.actor.tenantId}, ${incident.id}, ${nextAttempt}, 'queued')`;
    await transaction`insert into outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload) values (${randomUUID()}, ${input.actor.tenantId}, 'incident', ${incident.id}, 'incident.retry_requested', ${transaction.json({ incidentId: incident.id, attempt: nextAttempt })})`;
    await appendAuditEvent(transaction, { tenantId: input.actor.tenantId, actorId: input.actor.id, action: 'incident.retry_requested', targetType: 'incident', targetId: incident.id, metadata: { attempt: nextAttempt } });
    return { incidentId: incident.id, state: 'retrying' as const, attempt: nextAttempt };
  });
}

async function searchManual(actor: SessionUser, query: string): Promise<SearchResult[]> {
  const queryVector = vectorLiteral(deterministicEmbedding(query));
  return withTenant({ tenantId: actor.tenantId, userId: actor.id }, async (transaction) => {
    const rows = await transaction<
      Array<{
        id: string;
        source_id: string;
        source_version_id: string;
        title: string;
        page: number | null;
        start_offset: number;
        end_offset: number;
        content: string;
        injection_signals: string[];
        fts_rank: number;
        vector_rank: number;
      }>
    >`
      with permitted as (
        select c.*, s.title
        from document_chunks c
        join document_versions v on v.id = c.source_version_id and v.tenant_id = c.tenant_id
        join document_sources s on s.id = c.source_id and s.tenant_id = c.tenant_id
        where c.tenant_id = ${actor.tenantId}
          and v.state = 'published'
          and ${actor.role}::membership_role = any(s.allowed_roles)
      ), fts as (
        select id, row_number() over (order by ts_rank_cd(text_search, websearch_to_tsquery('english', ${query})) desc) as rank
        from permitted
        where text_search @@ websearch_to_tsquery('english', ${query})
        limit 20
      ), semantic as (
        select id, row_number() over (order by embedding <=> ${queryVector}::vector) as rank
        from permitted
        order by embedding <=> ${queryVector}::vector
        limit 20
      )
      select p.id, p.source_id, p.source_version_id, p.title, p.page,
             p.start_offset, p.end_offset, p.content, p.injection_signals,
             coalesce(f.rank, 1000)::int as fts_rank,
             coalesce(s.rank, 1000)::int as vector_rank
      from permitted p
      left join fts f on f.id = p.id
      left join semantic s on s.id = p.id
      where f.id is not null or s.id is not null
      limit 40
    `;
    const fused = reciprocalRankFusion([
      rows.filter((row) => row.fts_rank < 1000).map((row) => ({ id: row.id, rank: row.fts_rank })),
      rows.filter((row) => row.vector_rank < 1000).map((row) => ({ id: row.id, rank: row.vector_rank }))
    ]).slice(0, 5);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return fused.flatMap(({ id, score }, index) => {
      const row = byId.get(id);
      if (!row) return [];
      const excerpt = row.content.slice(0, 800);
      return [{
        chunkId: row.id,
        content: row.content,
        score,
        citation: {
          id: `cit-${index + 1}-${row.id.slice(0, 8)}`,
          sourceId: row.source_id,
          sourceVersionId: row.source_version_id,
          chunkId: row.id,
          title: row.title,
          page: row.page,
          startOffset: row.start_offset,
          endOffset: row.end_offset,
          excerpt
        },
        injectionSignals: [...new Set([...row.injection_signals, ...detectPromptInjection(row.content)])]
      }];
    });
  });
}

export async function searchManualForActor(actor: SessionUser, query: string): Promise<SearchResult[]> {
  return searchManual(actor, query);
}

async function persistDiagnosis(input: {
  actor: SessionUser;
  runId: string;
  correlationId: string;
  diagnosis: SafeDiagnosis;
  retrieved: SearchResult[];
  usage: { provider: string; model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  latencyMs: number;
  finalState: "completed" | "awaiting_approval";
}): Promise<void> {
  await withTenant({ tenantId: input.actor.tenantId, userId: input.actor.id }, async (transaction) => {
    const [updated] = await transaction<Array<{ id: string }>>`
      update assistant_runs
      set state = ${input.finalState}, diagnosis = ${transaction.json(input.diagnosis as unknown as postgres.JSONValue)},
          completed_at = ${input.finalState === "completed" ? transaction`now()` : null}, updated_at = now()
      where tenant_id = ${input.actor.tenantId} and id = ${input.runId} and state = 'running'
      returning id
    `;
    if (!updated) throw new DomainError("RUN_STATE_CONFLICT", "Run state changed during processing", 409);
    for (const [index, result] of input.retrieved.entries()) {
      await transaction`
        insert into retrieval_results
          (id, tenant_id, run_id, chunk_id, rank, score, retrieval_config)
        values
          (${randomUUID()}, ${input.actor.tenantId}, ${input.runId}, ${result.chunkId}, ${index + 1},
           ${result.score}, ${transaction.json({ method: "fts+vector+rrf", topK: 5, injectionSignals: result.injectionSignals } as postgres.JSONValue)})
      `;
    }
    await transaction`
      insert into model_usage
        (id, tenant_id, run_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, latency_ms)
      values
        (${randomUUID()}, ${input.actor.tenantId}, ${input.runId}, ${input.usage.provider}, ${input.usage.model},
         ${input.usage.inputTokens}, ${input.usage.outputTokens}, ${input.usage.estimatedCostUsd}, ${input.latencyMs})
    `;
    await appendRunEvent(transaction, {
      tenantId: input.actor.tenantId,
      runId: input.runId,
      type: "retrieval.completed",
      correlationId: input.correlationId,
      data: { resultCount: input.retrieved.length, method: "fts+vector+rrf" }
    });
    await appendRunEvent(transaction, {
      tenantId: input.actor.tenantId,
      runId: input.runId,
      type: "diagnosis.validated",
      correlationId: input.correlationId,
      data: {
        evidenceStatus: input.diagnosis.evidenceStatus,
        citationCount: input.diagnosis.citations.length,
        serverDecision: input.diagnosis.serverDecision
      }
    });
    if (input.finalState === "awaiting_approval") {
      const proposal = {
        summary: input.diagnosis.summary,
        steps: input.diagnosis.proposedSteps.filter((step) => step.risk === "consequential")
      };
      const proposalHash = contractHash(proposal);
      const approvalId = randomUUID();
      await transaction`
        insert into approval_requests
          (id, tenant_id, run_id, requester_id, proposal, proposal_hash, policy_version, state, expires_at)
        values
          (${approvalId}, ${input.actor.tenantId}, ${input.runId}, ${input.actor.id},
           ${transaction.json(proposal as unknown as postgres.JSONValue)}, ${proposalHash}, ${POLICY_VERSION},
           'pending', ${new Date(Date.now() + APPROVAL_TTL_MS).toISOString()})
      `;
      await appendRunEvent(transaction, {
        tenantId: input.actor.tenantId,
        runId: input.runId,
        type: "approval.required",
        correlationId: input.correlationId,
        data: { approvalId, proposalHash, policyVersion: POLICY_VERSION }
      });
    } else {
      await appendRunEvent(transaction, {
        tenantId: input.actor.tenantId,
        runId: input.runId,
        type: "run.completed",
        correlationId: input.correlationId,
        data: { result: "diagnosis" }
      });
    }
    await appendAuditEvent(transaction, {
      tenantId: input.actor.tenantId,
      actorId: input.actor.id,
      action: `assistant_run.${input.finalState}`,
      targetType: "assistant_run",
      targetId: input.runId,
      metadata: { diagnosisHash: contractHash(input.diagnosis), provider: input.usage.provider }
    });
  });
}

function mapRunSummary(row: {
  id: string;
  state: RunState;
  question: string;
  room_name: string;
  device_name: string;
  diagnosis: unknown;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}): RunSummary {
  return {
    id: row.id,
    state: row.state,
    question: row.question,
    roomName: row.room_name,
    deviceName: row.device_name,
    diagnosis: row.diagnosis ? SafeDiagnosisSchema.parse(row.diagnosis) : null,
    correlationId: row.correlation_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  return Math.round(boundedNumber(name, fallback, min, max));
}

function boundedNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}
