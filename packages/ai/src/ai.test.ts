import { describe, expect, it } from "vitest";
import type { Citation, DeviceStatus, SessionUser } from "@deviceops/contracts";
import { MockAiProvider, validateDiagnosis } from "./index.js";

const citation: Citation = {
  id: "manual-1:1",
  sourceId: "11111111-1111-4111-8111-111111111111",
  sourceVersionId: "22222222-2222-4222-8222-222222222222",
  chunkId: "33333333-3333-4333-8333-333333333333",
  title: "ProView Display Manual",
  page: 1,
  startOffset: 0,
  endOffset: 100,
  excerpt: "Verify power before checking the selected input."
};

const actor: SessionUser = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "tech@example.test",
  displayName: "Tech",
  tenantId: "55555555-5555-4555-8555-555555555555",
  tenantName: "AV Operations Lab",
  role: "technician",
  demoMode: false
};

describe("bounded AI orchestration", () => {
  it("returns a cited diagnosis and server-derived approval", async () => {
    const provider = new MockAiProvider();
    const status: DeviceStatus = {
      deviceId: "77777777-7777-4777-8777-777777777777",
      online: false,
      powerState: "off",
      temperatureC: null,
      input: null,
      firmwareVersion: "1.0.0",
      observedAt: new Date().toISOString(),
      simulated: true
    };
    const result = await provider.diagnose({
      actor,
      run: {
        id: "88888888-8888-4888-8888-888888888888",
        tenantId: actor.tenantId,
        roomId: "66666666-6666-4666-8666-666666666666",
        deviceId: status.deviceId
      },
      question: "Why is the display offline?",
      limits: { maxTurns: 6, maxToolCalls: 4, maxCostUsd: 0.1 },
      searchManual: async () => [
        { chunkId: citation.chunkId, content: citation.excerpt, score: 1, citation, injectionSignals: [] }
      ],
      getDeviceStatus: async () => status
    });
    expect(result.diagnosis.citations).toHaveLength(1);
    expect(result.diagnosis.serverDecision.requiresApproval).toBe(true);
    expect(result.usage.toolCalls).toBe(2);
  });

  it("rejects invented citation identifiers", () => {
    expect(() =>
      validateDiagnosis(
        {
          schemaVersion: "1.0",
          summary: "Unsupported",
          causes: [{ label: "Unknown", confidence: 0.5, citationIds: ["invented"] }],
          proposedSteps: [],
          uncertainty: "",
          evidenceStatus: "partial",
          dataFreshness: { deviceStatusObservedAt: null, limitation: null },
          citations: [{ ...citation, id: "invented" }],
          modelAdvisory: { abstained: false, requiresApproval: false }
        },
        []
      )
    ).toThrow(/Unknown citation/);
  });
});
