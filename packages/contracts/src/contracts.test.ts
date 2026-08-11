import { describe, expect, it } from "vitest";
import {
  CreateRunRequestSchema,
  DiagnosisSchema,
  stableJson
} from "./index.js";

describe("public contracts", () => {
  it("rejects client-supplied tenant identifiers", () => {
    expect(() =>
      CreateRunRequestSchema.parse({
        roomId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
        question: "Why is the display offline?",
        tenantId: "33333333-3333-4333-8333-333333333333"
      })
    ).toThrow();
  });

  it("requires cited causes", () => {
    expect(() =>
      DiagnosisSchema.parse({
        schemaVersion: "1.0",
        summary: "A diagnosis",
        causes: [{ label: "Power", confidence: 0.7, citationIds: [] }],
        proposedSteps: [],
        uncertainty: "",
        evidenceStatus: "partial",
        dataFreshness: { deviceStatusObservedAt: null, limitation: null },
        citations: [],
        modelAdvisory: { abstained: false, requiresApproval: false }
      })
    ).toThrow();
  });

  it("serializes objects deterministically", () => {
    expect(stableJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}'
    );
  });
});
