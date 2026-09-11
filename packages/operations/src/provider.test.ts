import { afterEach, expect, it, vi } from "vitest";
import { investigationMode, liveProvider } from "./provider.js";
afterEach(() => vi.unstubAllEnvs());
it("fails closed on misspelled providers rather than using fixtures", () => {
  vi.stubEnv("OPS_AGENT_MODE", "gmini");
  expect(investigationMode).toThrow("Invalid OPS_AGENT_MODE");
});
it("Gemini requires its own usage confirmation and rejects Bedrock results", () => {
  vi.stubEnv("OPS_AGENT_MODE", "gemini");
  vi.stubEnv("GEMINI_MODEL_ID", "gemini-2.5-flash");
  vi.stubEnv("AWS_CREDITS_CONFIRMED", "true");
  vi.stubEnv("GEMINI_USAGE_CONFIRMED", "false");
  expect(liveProvider().confirmed).toBe(false);
  vi.stubEnv("GEMINI_USAGE_CONFIRMED", "true");
  const selected = liveProvider();
  expect(selected.confirmed).toBe(true);
  expect(selected.accepts({provider:"strands-bedrock", modelId:"us.amazon.nova-lite-v1:0"})).toBe(false);
  expect(selected.accepts({provider:"strands-gemini", modelId:"gemini-2.5-pro"})).toBe(false);
  expect(selected.accepts({provider:"strands-gemini", modelId:"gemini-2.5-flash"})).toBe(true);
  const cost = selected.cost({inputTokens:120000, outputTokens:8000});
  expect(cost).toBeCloseTo(0.056);
  expect(selected.reserve).toBeGreaterThanOrEqual(cost);
});
it("Gemini confirmation cannot enable Bedrock", () => {
  vi.stubEnv("OPS_AGENT_MODE", "bedrock");
  vi.stubEnv("GEMINI_USAGE_CONFIRMED", "true");
  vi.stubEnv("AWS_CREDITS_CONFIRMED", "false");
  expect(liveProvider().confirmed).toBe(false);
});
it("3.7 keeps conservative future pricing and rejects a different returned model", () => {
  vi.stubEnv("OPS_AGENT_MODE", "gemini");
  vi.stubEnv("GEMINI_MODEL_ID", "gemini-2.5-flash");
  vi.stubEnv("GEMINI_MODEL_ID", "gemini-3.7-flash");
  const selected=liveProvider();
  expect(selected.cost({inputTokens:120000, outputTokens:8000})).toBeCloseTo(0.24);
  expect(selected.reserve).toBeGreaterThanOrEqual(0.24);
  expect(selected.accepts({provider:"strands-gemini",modelId:"gemini-2.5-flash"})).toBe(false);
  expect(selected.accepts({provider:"strands-gemini",modelId:"gemini-3.7-flash"})).toBe(true);
});
