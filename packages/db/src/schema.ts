import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const roleEnum = pgEnum("membership_role", [
  "owner",
  "admin",
  "manager",
  "technician",
  "viewer"
]);
export const sessionKindEnum = pgEnum("session_kind", ["web", "mobile"]);
export const runStateEnum = pgEnum("run_state", [
  "queued",
  "running",
  "waiting_for_tool",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
  "expired"
]);
export const incidentStateEnum = pgEnum("incident_state", [
  "proposed",
  "approval_pending",
  "approved",
  "denied",
  "expired",
  "dispatching",
  "delivered",
  "retrying",
  "dead_lettered",
  "cancelled"
]);
export const documentVersionStateEnum = pgEnum("document_version_state", [
  "pending",
  "processing",
  "published",
  "retired",
  "failed"
]);
export const mediaKindEnum = pgEnum("media_kind", ["image", "voice"]);
export const mediaStateEnum = pgEnum("media_state", [
  "created",
  "uploading",
  "quarantined",
  "scanning",
  "normalizing",
  "ready",
  "attached",
  "rejected",
  "failed",
  "expired",
  "deleted"
]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    demoMode: boolean("demo_mode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("tenants_slug_uq").on(table.slug)]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("users_email_uq").on(sql`lower(${table.email})`)]
);

export const memberships = pgTable(
  "memberships",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] }), index("memberships_user_idx").on(table.userId)]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    kind: sessionKindEnum("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    refreshHash: text("refresh_hash"),
    csrfHash: text("csrf_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
    uniqueIndex("sessions_refresh_hash_uq").on(table.refreshHash),
    index("sessions_user_tenant_idx").on(table.userId, table.tenantId)
  ]
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    location: text("location").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("rooms_tenant_idx").on(table.tenantId)]
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    roomId: uuid("room_id").notNull().references(() => rooms.id),
    name: text("name").notNull(),
    manufacturer: text("manufacturer").notNull(),
    model: text("model").notNull(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("devices_tenant_room_idx").on(table.tenantId, table.roomId)]
);

export const deviceStatusSnapshots = pgTable(
  "device_status_snapshots",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    deviceId: uuid("device_id").notNull().references(() => devices.id),
    payload: jsonb("payload").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("device_status_latest_idx").on(table.tenantId, table.deviceId, table.observedAt)]
);

export const documentSources = pgTable(
  "document_sources",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    title: text("title").notNull(),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    license: text("license").notNull(),
    allowedRoles: roleEnum("allowed_roles").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("document_sources_tenant_idx").on(table.tenantId)]
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sourceId: uuid("source_id").notNull().references(() => documentSources.id),
    versionLabel: text("version_label").notNull(),
    checksum: text("checksum").notNull(),
    parserVersion: text("parser_version").notNull(),
    state: documentVersionStateEnum("state").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("document_versions_checksum_uq").on(table.tenantId, table.sourceId, table.checksum),
    index("document_versions_state_idx").on(table.tenantId, table.state)
  ]
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sourceId: uuid("source_id").notNull().references(() => documentSources.id),
    sourceVersionId: uuid("source_version_id").notNull().references(() => documentVersions.id),
    page: integer("page"),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    textSearch: tsvector("text_search").generatedAlwaysAs(sql`to_tsvector('english', content)`),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    injectionSignals: text("injection_signals").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("document_chunks_hash_uq").on(table.tenantId, table.sourceVersionId, table.contentHash),
    index("document_chunks_tenant_version_idx").on(table.tenantId, table.sourceVersionId),
    index("document_chunks_fts_idx").using("gin", table.textSearch),
    index("document_chunks_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))
  ]
);

export const assistantRuns = pgTable(
  "assistant_runs",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    requesterId: uuid("requester_id").notNull().references(() => users.id),
    roomId: uuid("room_id").notNull().references(() => rooms.id),
    deviceId: uuid("device_id").notNull().references(() => devices.id),
    state: runStateEnum("state").notNull(),
    question: text("question").notNull(),
    diagnosis: jsonb("diagnosis"),
    correlationId: uuid("correlation_id").notNull(),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("assistant_runs_tenant_state_idx").on(table.tenantId, table.state, table.createdAt)]
);

export const runMessages = pgTable(
  "run_messages",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => assistantRuns.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("run_messages_run_idx").on(table.tenantId, table.runId, table.createdAt)]
);

export const runEvents = pgTable(
  "run_events",
  {
    sequence: bigserial("sequence", { mode: "bigint" }).primaryKey(),
    id: uuid("id").notNull(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => assistantRuns.id),
    type: text("type").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    data: jsonb("data").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("run_events_id_uq").on(table.id), index("run_events_replay_idx").on(table.tenantId, table.runId, table.sequence)]
);

export const retrievalResults = pgTable(
  "retrieval_results",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => assistantRuns.id),
    chunkId: uuid("chunk_id").notNull().references(() => documentChunks.id),
    rank: integer("rank").notNull(),
    score: numeric("score", { precision: 12, scale: 8 }).notNull(),
    retrievalConfig: jsonb("retrieval_config").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("retrieval_results_run_idx").on(table.tenantId, table.runId, table.rank)]
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => assistantRuns.id),
    name: text("name").notNull(),
    arguments: jsonb("arguments").notNull(),
    resultSummary: jsonb("result_summary"),
    policyVersion: text("policy_version").notNull(),
    status: text("status").notNull(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("tool_calls_run_idx").on(table.tenantId, table.runId, table.createdAt)]
);

export const modelUsage = pgTable(
  "model_usage",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => assistantRuns.id),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("model_usage_run_idx").on(table.tenantId, table.runId)]
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => assistantRuns.id),
    requesterId: uuid("requester_id").notNull().references(() => users.id),
    proposal: jsonb("proposal").notNull(),
    proposalHash: text("proposal_hash").notNull(),
    policyVersion: text("policy_version").notNull(),
    state: text("state").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decisionReason: text("decision_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("approval_proposal_uq").on(table.tenantId, table.runId, table.proposalHash)]
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => assistantRuns.id),
    approvalId: uuid("approval_id").notNull().references(() => approvalRequests.id),
    state: incidentStateEnum("state").notNull(),
    commandKey: text("command_key").notNull(),
    summary: text("summary").notNull(),
    assignedTeam: text("assigned_team").notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("incidents_command_uq").on(table.commandKey), index("incidents_tenant_state_idx").on(table.tenantId, table.state)]
);

export const incidentAttempts = pgTable(
  "incident_attempts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    responseCode: integer("response_code"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("incident_attempt_uq").on(table.incidentId, table.attempt)]
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("outbox_pending_idx").on(table.publishedAt, table.availableAt)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id),
    nonce: text("nonce").notNull(),
    signature: text("signature").notNull(),
    state: text("state").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("webhook_delivery_nonce_uq").on(table.id, table.nonce)]
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.actorId, table.route, table.key] })]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    sequence: bigserial("sequence", { mode: "bigint" }).primaryKey(),
    id: uuid("id").notNull(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").notNull(),
    previousHash: text("previous_hash"),
    eventHash: text("event_hash").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("audit_events_id_uq").on(table.id), index("audit_tenant_sequence_idx").on(table.tenantId, table.sequence)]
);

export const evalDatasets = pgTable(
  "eval_datasets",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    version: text("version").notNull(),
    commitSha: text("commit_sha").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("eval_dataset_version_uq").on(table.tenantId, table.name, table.version)]
);

export const evalCases = pgTable(
  "eval_cases",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    datasetId: uuid("dataset_id").notNull().references(() => evalDatasets.id),
    externalId: text("external_id").notNull(),
    category: text("category").notNull(),
    input: jsonb("input").notNull(),
    expected: jsonb("expected").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("eval_case_external_uq").on(table.datasetId, table.externalId)]
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    datasetId: uuid("dataset_id").notNull().references(() => evalDatasets.id),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    config: jsonb("config").notNull(),
    state: text("state").notNull(),
    summary: jsonb("summary"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [index("eval_runs_tenant_idx").on(table.tenantId, table.startedAt)]
);

export const evalResults = pgTable(
  "eval_results",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    evalRunId: uuid("eval_run_id").notNull().references(() => evalRuns.id),
    evalCaseId: uuid("eval_case_id").notNull().references(() => evalCases.id),
    retrievalHitAt5: boolean("retrieval_hit_at_5").notNull(),
    abstentionCorrect: boolean("abstention_correct").notNull(),
    schemaValid: boolean("schema_valid").notNull(),
    citationValid: boolean("citation_valid").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    detail: jsonb("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("eval_result_case_uq").on(table.evalRunId, table.evalCaseId)]
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    ownerId: uuid("owner_id").notNull().references(() => users.id),
    runId: uuid("run_id").references(() => assistantRuns.id),
    kind: mediaKindEnum("kind").notNull(),
    state: mediaStateEnum("state").notNull(),
    storageProvider: text("storage_provider").notNull(),
    quarantineKey: text("quarantine_key").notNull(),
    cleanKey: text("clean_key"),
    uploadTokenHash: text("upload_token_hash"),
    uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
    declaredMime: text("declared_mime").notNull(),
    detectedMime: text("detected_mime"),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    scanner: text("scanner"),
    scannerVersion: text("scanner_version"),
    scanStatus: text("scan_status"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    processorVersion: text("processor_version").notNull(),
    transcript: text("transcript"),
    visualObservation: text("visual_observation"),
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("media_assets_tenant_state_idx").on(table.tenantId, table.state, table.createdAt)]
);

export const mediaEvents = pgTable(
  "media_events",
  {
    sequence: bigserial("sequence", { mode: "bigint" }).primaryKey(),
    id: uuid("id").notNull(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    mediaId: uuid("media_id").notNull().references(() => mediaAssets.id),
    state: mediaStateEnum("state").notNull(),
    detail: jsonb("detail").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("media_events_id_uq").on(table.id), index("media_events_asset_idx").on(table.tenantId, table.mediaId, table.sequence)]
);
