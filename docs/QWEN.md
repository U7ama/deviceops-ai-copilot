# Qwen reasoning provider

DeviceOps uses Strands OpenAIModel with Alibaba Cloud Qwen (such as `qwen3.7-max` or `qwen3.7-flash`) at https://dashscope-intl.aliyuncs.com/compatible-mode/v1. The private .env.demo contains ABQWEN_API_KEY, QWEN_MODEL_ID, QWEN_BASE_URL and QWEN_USAGE_CONFIRMED=true. Set OPS_AGENT_MODE=qwen. Gemini is no longer selectable; historical Gemini diagnoses remain readable.

Thinking is disabled, provider retries are disabled, and model/tool/token ceilings and backend approval policy remain enforced. Rates supplied for this model are $0.15 input and $0.47 output per million tokens; free quota is still metered at these rates. Keep the provider account in Free Quota Only mode. No automatic provider fallback occurs.

Bedrock remains an explicitly selected alternative. Qwen uses lexical retrieval; this change does not enable Titan or verify AWS access.

## Cached local development

Use compose.demo.yaml, compose.enterprise.yaml, compose.qwen.yaml and compose.qwen-dev.yaml together with --env-file .env.demo and --profile qwen. Use up -d --no-build --pull never web worker strands. The development override mounts source and the installed OpenAI client packages read-only into existing images. It is not a portable release image. No Docker caches need deletion.

A bounded live tool-call probe succeeded with 290 input and 18 output tokens. Full operational investigation verification is recorded separately; this probe alone does not establish it.

Live Strands specialist verification completed: 12 model calls, 7 synthetic evidence-tool calls, 26,629 input and 5,888 output tokens. See [verification](verification/qwen-live.json). This is not a full backend MCP/approval/recovery rehearsal. The preceding reduced-budget probe stopped safely with BudgetExceeded.

## Demo input budget

The Qwen compose profile sets AGENT_MAX_INPUT_TOKENS=300000 (configurable, maximum 300000), applied to Strands, backend result validation and monetary reservation. The default without this profile remains 120000. Specialist limits remain 12 model calls, 12000 output tokens, 24 evidence-tool calls and 180 seconds. Budget failures retain their specific reason in the API and incident error. These limits are independent of Alibaba free quota. Rehearsal evidence is recorded separately; live provider availability is never guaranteed.

## Current selection, validated lineup and recovery verification

The selected model is `qwen3.7-flash`. Silent cross-model failover is completely disabled: requests use a single configured model, failed requests retain reservations, and returned model identity must match configuration exactly.

### Validated Model Lineup

The supported model suite on Alibaba Cloud Model Studio is strictly verified for active free tier quota, exact tool-calling parameters, and structured JSON schema conformance:
- **`qwen3.7-flash`** (Default): Fast (~32.9s full pipeline), clean citation adherence, active free quota.
- **`qwen3.7-plus`**: Balanced reasoning tier, verified for structured tool calling with `enable_thinking: False`, active free quota.
- **`qwen3.7-max`**: Flagship Qwen reasoning (~41.8s full pipeline), deep narrative synthesis, active free quota.
- **`kimi-k3`**: Moonshot flagship, requires `temperature=0.0` (dynamically configured in `agent.py`), active free quota.
- **`glm-5.2`**: Zhipu GLM flagship, structured analytical reasoning, active free quota.
- **`deepseek-v4-pro-0813`**: DeepSeek flagship, rigorous technical diagnosis, active free quota.

Incompatible or exhausted models (`qwen3.8-flash`, `qwen3.8-max`, `qwen3.8-2.4t-a95b`, `qwen3.6-plus`, `qwen3.6-flash`) have been removed from supported configurations.

### Verified Recovery Rehearsals

Both core operational scenarios are fully verified end-to-end under the corrected runtime (see [qwen-recovery.json](verification/qwen-recovery.json)):
1. **`service_hang`**: Autonomous remediation via `restart_service` on root camera device `6dbe3967-567e-4aaa-8955-b5a01d566878`.
2. **`switch_failure`** (Incident `f5efca60-94fc-440d-b4f2-65d9818f29dd`): Verified under the strict single-model runtime with `qwen3.7-flash`. Multi-specialist investigation synthesized the diagnosis, verified configured topology dependencies, evaluated reachability without hallucinations, and proposed `restart_switch`. A human manager authorized the exact proposal hash, simulator executed the restart, and sustained post-restart healthy telemetry resolved the incident (`passed: true`, elapsed 104s).
