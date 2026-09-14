import { afterEach, expect, it, vi } from "vitest";
import { investigationMode, liveProvider } from "./provider.js";
afterEach(() => vi.unstubAllEnvs());
it("fails closed on misspelled providers rather than using fixtures", () => {
  vi.stubEnv("OPS_AGENT_MODE", "gmini");
  expect(investigationMode).toThrow("Invalid OPS_AGENT_MODE");
});
it("Qwen requires its own usage confirmation and rejects Bedrock results", () => {
  vi.stubEnv("OPS_AGENT_MODE", "qwen");
  vi.stubEnv("QWEN_MODEL_ID", "qwen3.7-flash");
  vi.stubEnv("AWS_CREDITS_CONFIRMED", "true");
  vi.stubEnv("QWEN_USAGE_CONFIRMED", "false");
  expect(liveProvider().confirmed).toBe(false);
  vi.stubEnv("QWEN_USAGE_CONFIRMED", "true");
  const selected = liveProvider();
  expect(selected.confirmed).toBe(true);
  expect(selected.accepts({provider:"strands-bedrock", modelId:"us.amazon.nova-lite-v1:0"})).toBe(false);
  expect(selected.accepts({provider:"strands-qwen", modelId:"qwen-2.5-pro"})).toBe(false);
  expect(selected.accepts({provider:"strands-qwen", modelId:"qwen3.7-flash"})).toBe(true);
  const cost = selected.cost({inputTokens:120000, outputTokens:8000});
  expect(cost).toBeCloseTo(0.02176);
  expect(selected.reserve).toBeGreaterThanOrEqual(cost);
});
it("Qwen confirmation cannot enable Bedrock", () => {
  vi.stubEnv("OPS_AGENT_MODE", "bedrock");
  vi.stubEnv("QWEN_USAGE_CONFIRMED", "true");
  vi.stubEnv("AWS_CREDITS_CONFIRMED", "false");
  expect(liveProvider().confirmed).toBe(false);
});
it("Qwen keeps metered pricing and rejects a different returned model", () => {
  vi.stubEnv("OPS_AGENT_MODE", "qwen");
  vi.stubEnv("QWEN_MODEL_ID", "qwen3.7-flash");
  const selected=liveProvider();
  expect(selected.cost({inputTokens:120000, outputTokens:8000})).toBeCloseTo(0.02176);
  expect(selected.reserve).toBeGreaterThanOrEqual(0.02176);
  expect(selected.accepts({provider:"strands-qwen",modelId:"unbudgeted-model"})).toBe(false);
  expect(selected.accepts({provider:"strands-qwen",modelId:"qwen3.7-flash"})).toBe(true);
  vi.stubEnv("QWEN_MODEL_ID", "qwen3.7-max");
  expect(liveProvider().accepts({provider:"strands-qwen",modelId:"qwen3.7-max"})).toBe(true);
});
it('uses the configured demo input ceiling in the monetary reservation', () => {
  vi.stubEnv('OPS_AGENT_MODE','qwen');
  vi.stubEnv('AGENT_MAX_INPUT_TOKENS','400000');
  const p=liveProvider();
  expect(p.inputLimit).toBe(400000);
  expect(p.reserve).toBeGreaterThanOrEqual(p.cost({inputTokens:400000,outputTokens:12000}));
  vi.stubEnv('AGENT_MAX_INPUT_TOKENS','500001');
  expect(liveProvider).toThrow('Invalid input token limit');
});
