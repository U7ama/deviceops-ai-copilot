import { describe, expect, it } from "vitest";
import type { Diagnosis, SessionUser } from "@deviceops/contracts";
import {
  assertCanApprove,
  bindReadToolContext,
  deriveSafeDiagnosis
} from "./index.js";

const actor: SessionUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "tech@example.test",
  displayName: "Tech",
  tenantId: "22222222-2222-4222-8222-222222222222",
  tenantName: "AV Operations Lab",
  role: "technician",
  demoMode: false
};

describe("deterministic policy", () => {
  it("overwrites model-supplied identity scope", () => {
    const bound = bindReadToolContext(
      actor,
      {
        tenantId: actor.tenantId,
        roomId: "33333333-3333-4333-8333-333333333333",
        deviceId: "44444444-4444-4444-8444-444444444444"
      },
      { tenantId: "attacker", userId: "attacker", query: "status" }
    );
    expect(bound.tenantId).toBe(actor.tenantId);
    expect(bound).not.toHaveProperty("userId");
  });

  it("denies self approval", () => {
    expect(() =>
      assertCanApprove({ ...actor, role: "manager" }, actor.id, actor.tenantId)
    ).toThrow(/cannot approve/i);
  });

  it("derives approval without trusting the model advisory", () => {
    const diagnosis: Diagnosis = {
      schemaVersion: "1.0",
      summary: "Escalate the incident.",
      causes: [],
      proposedSteps: [
        {
          id: "incident",
          instruction: "Create an incident for review.",
          risk: "consequential",
          toolProposal: { name: "create_incident", reason: "Device offline" }
        }
      ],
      uncertainty: "No direct device access.",
      evidenceStatus: "insufficient",
      dataFreshness: { deviceStatusObservedAt: null, limitation: "No status" },
      citations: [],
      modelAdvisory: { abstained: false, requiresApproval: false }
    };
    const safe = deriveSafeDiagnosis(diagnosis);
    expect(safe.serverDecision.requiresApproval).toBe(true);
    expect(safe.serverDecision.abstained).toBe(true);
  });
});
