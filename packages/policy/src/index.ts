import type {
  Diagnosis,
  Role,
  SafeDiagnosis,
  SessionUser
} from "@deviceops/contracts";

export const POLICY_VERSION = "2026-08-10.1" as const;

const roleRank: Record<Role, number> = {
  viewer: 0,
  technician: 1,
  manager: 2,
  admin: 3,
  owner: 4
};

export function hasMinimumRole(actual: Role, required: Role): boolean {
  return roleRank[actual] >= roleRank[required];
}

export function assertTenantActor(
  actor: SessionUser,
  recordTenantId: string
): void {
  if (actor.tenantId !== recordTenantId) {
    throw new PolicyError("TENANT_SCOPE_DENIED", "Tenant scope mismatch");
  }
}

export function assertCanApprove(
  actor: SessionUser,
  requesterId: string,
  recordTenantId: string
): void {
  assertTenantActor(actor, recordTenantId);
  if (!hasMinimumRole(actor.role, "manager")) {
    throw new PolicyError("APPROVAL_ROLE_DENIED", "Manager role is required");
  }
  if (actor.id === requesterId) {
    throw new PolicyError(
      "SELF_APPROVAL_DENIED",
      "The requester cannot approve their own proposal"
    );
  }
  if (actor.demoMode) {
    throw new PolicyError(
      "DEMO_SIDE_EFFECT_DENIED",
      "Consequential actions are disabled in demo mode"
    );
  }
}

export function deriveSafeDiagnosis(diagnosis: Diagnosis): SafeDiagnosis {
  const hasConsequentialStep = diagnosis.proposedSteps.some(
    (step) => step.risk === "consequential" || step.toolProposal !== null
  );
  const hasUsableEvidence =
    diagnosis.evidenceStatus !== "insufficient" && diagnosis.citations.length > 0;

  return {
    ...diagnosis,
    serverDecision: {
      abstained: !hasUsableEvidence,
      requiresApproval: hasConsequentialStep,
      riskClass: hasConsequentialStep
        ? "consequential"
        : diagnosis.proposedSteps.length > 0
          ? "read_only"
          : "none",
      policyVersion: POLICY_VERSION
    }
  };
}

export function assertToolBudget(
  usedToolCalls: number,
  maxToolCalls: number
): void {
  if (usedToolCalls >= maxToolCalls) {
    throw new PolicyError("TOOL_BUDGET_EXHAUSTED", "Tool budget exhausted");
  }
}

export function bindReadToolContext<T extends Record<string, unknown>>(
  actor: SessionUser,
  run: { tenantId: string; roomId: string; deviceId: string },
  modelArguments: T
): T & { tenantId: string; roomId: string; deviceId: string } {
  assertTenantActor(actor, run.tenantId);
  const { tenantId: _ignoredTenant, userId: _ignoredUser, ...safeArguments } =
    modelArguments;
  return {
    ...(safeArguments as T),
    tenantId: actor.tenantId,
    roomId: run.roomId,
    deviceId: run.deviceId
  };
}

export class PolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}
