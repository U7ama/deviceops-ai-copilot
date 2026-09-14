/** Explicit provider selection; the durable budget is shared across providers. */
export function investigationMode() {
  const value = process.env.OPS_AGENT_MODE ?? "fixture";
  if (value !== "fixture" && value !== "bedrock" && value !== "qwen")
    throw new Error("Invalid OPS_AGENT_MODE");
  return value;
}
export function liveProvider() {
  const mode = investigationMode();
  if (mode === "fixture") throw new Error("Fixture has no live provider");
  const qwen = mode === "qwen";
  const modelId = process.env.QWEN_MODEL_ID ?? "qwen3.7-flash";
  const supportedQwen = [
    "qwen3.7-flash",
    "qwen3.7-plus",
    "qwen3.7-max",
    "glm-5.2",
    "deepseek-v4-pro-0813",
    "kimi-k3",
  ];
  if (qwen && !supportedQwen.includes(modelId))
    throw new Error("Unsupported Qwen model");
  // User-supplied Qwen rates; budget usage even while free quota is available.
  const inputRate = qwen ? 0.15 : Number(process.env.NOVA_INPUT_USD_PER_MILLION ?? 0.06);
  const outputRate = qwen ? 0.47 : Number(process.env.NOVA_OUTPUT_USD_PER_MILLION ?? 0.24);
  if (![inputRate, outputRate].every(rate => Number.isFinite(rate) && rate >= 0))
    throw new Error("Invalid model pricing");
  const inputLimit = Number(process.env.AGENT_MAX_INPUT_TOKENS ?? 120000);
  if (!Number.isInteger(inputLimit) || inputLimit < 1 || inputLimit > 500000)
    throw new Error("Invalid input token limit");
  return {
    inputLimit,
    provider: qwen ? "strands-qwen" as const : "strands-bedrock" as const,
    confirmed: qwen ? process.env.QWEN_USAGE_CONFIRMED === "true" : process.env.AWS_CREDITS_CONFIRMED === "true",
    // Reserve at least the full token ceiling, including a margin for uncertain outcomes.
    reserve: Math.max(qwen ? 0.10 : 0.05, (inputLimit * inputRate + (process.env.OPS_INVESTIGATION_WORKFLOW === "specialists" ? 12000 : 8000) * outputRate) / 1e6),
    cost(usage: {inputTokens: number; outputTokens: number}) {
      return (usage.inputTokens * inputRate + usage.outputTokens * outputRate) / 1e6;
    },
    accepts(result: {provider: string; modelId: string}) {
      return result.provider === (qwen ? "strands-qwen" : "strands-bedrock") &&
        (!qwen || result.modelId === modelId);
    },
  };
}
