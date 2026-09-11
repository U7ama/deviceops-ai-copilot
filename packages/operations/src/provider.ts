/** Explicit provider selection; the durable budget is shared across providers. */
export function investigationMode() {
  const value = process.env.OPS_AGENT_MODE ?? "fixture";
  if (value !== "fixture" && value !== "bedrock" && value !== "gemini")
    throw new Error("Invalid OPS_AGENT_MODE");
  return value;
}
export function liveProvider() {
  const mode = investigationMode();
  if (mode === "fixture") throw new Error("Fixture has no live provider");
  const gemini = mode === "gemini";
  const modelId = process.env.GEMINI_MODEL_ID ?? "gemini-3.7-flash";
  if (gemini && !["gemini-2.5-flash", "gemini-3.7-flash"].includes(modelId))
    throw new Error("Unsupported Gemini model");
  // Conservative post-introductory 3.7 rates; free-tier usage is still budgeted.
  const inputRate = gemini ? (modelId === "gemini-3.7-flash" ? 1.50 : 0.30) : Number(process.env.NOVA_INPUT_USD_PER_MILLION ?? 0.06);
  const outputRate = gemini ? (modelId === "gemini-3.7-flash" ? 7.50 : 2.50) : Number(process.env.NOVA_OUTPUT_USD_PER_MILLION ?? 0.24);
  if (![inputRate, outputRate].every(rate => Number.isFinite(rate) && rate >= 0))
    throw new Error("Invalid model pricing");
  return {
    provider: gemini ? "strands-gemini" as const : "strands-bedrock" as const,
    confirmed: gemini ? process.env.GEMINI_USAGE_CONFIRMED === "true" : process.env.AWS_CREDITS_CONFIRMED === "true",
    // Reserve at least the full token ceiling, including a margin for uncertain outcomes.
    reserve: Math.max(gemini ? 0.10 : 0.05, (120000 * inputRate + (process.env.OPS_INVESTIGATION_WORKFLOW === "specialists" ? 12000 : 8000) * outputRate) / 1e6),
    cost(usage: {inputTokens: number; outputTokens: number}) {
      return (usage.inputTokens * inputRate + usage.outputTokens * outputRate) / 1e6;
    },
    accepts(result: {provider: string; modelId: string}) {
      return result.provider === (gemini ? "strands-gemini" : "strands-bedrock") &&
        (!gemini || result.modelId === modelId);
    },
  };
}
