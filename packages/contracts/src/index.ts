import { createHash } from "node:crypto";
import { z } from "zod";

export const CONTRACT_VERSION = "1.0.0" as const;

export const UuidSchema = z.uuid();
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const RoleSchema = z.enum([
  "owner",
  "admin",
  "manager",
  "technician",
  "viewer"
]);
export type Role = z.infer<typeof RoleSchema>;

export const RunStateSchema = z.enum([
  "queued",
  "running",
  "waiting_for_tool",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
  "expired"
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const IncidentStateSchema = z.enum([
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
export type IncidentState = z.infer<typeof IncidentStateSchema>;

export const CitationSchema = z
  .object({
    id: z.string().min(1),
    sourceId: UuidSchema,
    sourceVersionId: UuidSchema,
    chunkId: UuidSchema,
    title: z.string().min(1).max(240),
    page: z.number().int().positive().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    excerpt: z.string().min(1).max(800)
  })
  .strict()
  .refine((value) => value.endOffset > value.startOffset, {
    message: "Citation endOffset must be greater than startOffset"
  });
export type Citation = z.infer<typeof CitationSchema>;

export const CauseSchema = z
  .object({
    label: z.string().min(1).max(180),
    confidence: z.number().min(0).max(1),
    citationIds: z.array(z.string().min(1)).min(1).max(6)
  })
  .strict();

export const ProposedStepSchema = z
  .object({
    id: z.string().min(1).max(80),
    instruction: z.string().min(1).max(500),
    risk: z.enum(["read_only", "low", "consequential"]),
    toolProposal: z
      .object({
        name: z.enum(["create_incident", "notify_team"]),
        reason: z.string().min(1).max(300)
      })
      .strict()
      .nullable()
  })
  .strict();

export const DiagnosisSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    summary: z.string().min(1).max(1_200),
    causes: z.array(CauseSchema).max(5),
    proposedSteps: z.array(ProposedStepSchema).max(8),
    uncertainty: z.string().max(800),
    evidenceStatus: z.enum(["sufficient", "partial", "insufficient"]),
    dataFreshness: z
      .object({
        deviceStatusObservedAt: IsoDateTimeSchema.nullable(),
        limitation: z.string().max(500).nullable()
      })
      .strict(),
    citations: z.array(CitationSchema).max(12),
    modelAdvisory: z
      .object({
        abstained: z.boolean(),
        requiresApproval: z.boolean()
      })
      .strict()
  })
  .strict();
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const SafeDiagnosisSchema = DiagnosisSchema.extend({
  serverDecision: z
    .object({
      abstained: z.boolean(),
      requiresApproval: z.boolean(),
      riskClass: z.enum(["none", "read_only", "consequential"]),
      policyVersion: z.string().min(1)
    })
    .strict()
});
export type SafeDiagnosis = z.infer<typeof SafeDiagnosisSchema>;

export const CreateRunRequestSchema = z
  .object({
    roomId: UuidSchema,
    deviceId: UuidSchema,
    question: z.string().trim().min(3).max(4_000),
    mediaIds: z.array(UuidSchema).max(4).default([])
  })
  .strict();
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const CreateRunResponseSchema = z
  .object({
    runId: UuidSchema,
    status: z.literal("queued"),
    eventsUrl: z.string().startsWith("/api/v1/runs/")
  })
  .strict();

export const RunEventTypeSchema = z.enum([
  "run.accepted",
  "run.started",
  "retrieval.completed",
  "tool.started",
  "tool.completed",
  "diagnosis.validated",
  "approval.required",
  "run.completed",
  "run.failed",
  "incident.dispatched",
  "incident.delivered"
]);

export const RunEventSchema = z
  .object({
    id: UuidSchema,
    runId: UuidSchema,
    sequence: z.string().regex(/^\d+$/),
    type: RunEventTypeSchema,
    occurredAt: IsoDateTimeSchema,
    correlationId: UuidSchema,
    data: z.record(z.string(), z.unknown())
  })
  .strict();
export type RunEvent = z.infer<typeof RunEventSchema>;

export const ProblemDetailsSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1),
    instance: z.string().optional(),
    requestId: UuidSchema,
    code: z.string().min(1)
  })
  .strict();
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const LoginRequestSchema = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(200),
    client: z.enum(["web", "mobile"]).default("web")
  })
  .strict();

export const SessionUserSchema = z
  .object({
    id: UuidSchema,
    email: z.email(),
    displayName: z.string().min(1),
    tenantId: UuidSchema,
    tenantName: z.string().min(1),
    role: RoleSchema,
    demoMode: z.boolean()
  })
  .strict();
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const MediaKindSchema = z.enum(["image", "voice"]);
export const MediaStateSchema = z.enum([
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

export const CreateMediaUploadSchema = z
  .object({
    kind: MediaKindSchema,
    bytes: z.number().int().positive().max(25 * 1024 * 1024),
    declaredMime: z.string().min(3).max(120),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export const UploadTargetSchema = z
  .object({
    provider: z.enum(["local", "s3"]),
    method: z.enum(["PUT", "POST"]),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    fields: z.record(z.string(), z.string()).optional(),
    expiresAt: IsoDateTimeSchema,
    mediaId: UuidSchema
  })
  .strict();

export const ApprovalDecisionSchema = z
  .object({
    decision: z.enum(["approved", "denied"]),
    reason: z.string().trim().min(3).max(500),
    proposalHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export const SignedWebhookEnvelopeSchema = z
  .object({
    deliveryId: UuidSchema,
    timestamp: z.number().int().positive(),
    nonce: z.string().min(16).max(128),
    payloadBase64: z.string().min(1),
    signature: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export const DeviceStatusSchema = z
  .object({
    deviceId: UuidSchema,
    online: z.boolean(),
    powerState: z.enum(["on", "standby", "off", "unknown"]),
    temperatureC: z.number().min(-50).max(150).nullable(),
    input: z.string().max(80).nullable(),
    firmwareVersion: z.string().max(80).nullable(),
    observedAt: IsoDateTimeSchema,
    simulated: z.literal(true)
  })
  .strict();
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contractHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export const ContractManifestSchema = z
  .object({
    name: z.literal("deviceops-contracts"),
    version: z.literal(CONTRACT_VERSION),
    generatedAt: IsoDateTimeSchema,
    schemasSha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export function contractSchemasHash(): string {
  return contractHash({
    version: CONTRACT_VERSION,
    schemas: {
      diagnosis: z.toJSONSchema(DiagnosisSchema),
      safeDiagnosis: z.toJSONSchema(SafeDiagnosisSchema),
      createRun: z.toJSONSchema(CreateRunRequestSchema),
      runEvent: z.toJSONSchema(RunEventSchema),
      problem: z.toJSONSchema(ProblemDetailsSchema),
      mediaUpload: z.toJSONSchema(CreateMediaUploadSchema),
      approvalDecision: z.toJSONSchema(ApprovalDecisionSchema),
      webhook: z.toJSONSchema(SignedWebhookEnvelopeSchema),
      deviceStatus: z.toJSONSchema(DeviceStatusSchema)
    }
  });
}
