# DeviceOps Strands service

This private Python service uses Strands Agents 1.54.0 with explicitly selected Amazon Bedrock or Google Gemini, seven scoped read-only MCP tools, and a validated diagnosis/action proposal. TypeScript owns authorization, evidence validation, durable jobs, approvals, commands, and recovery verification. The service cannot execute device commands.

## Run locally

Requires Linux/WSL, Python 3.12, the repository's Node 22.16.0 installation, and root `npm ci` dependencies. From the repository root:

```sh
python3 -m venv apps/strands-agent/.venv
apps/strands-agent/.venv/bin/pip install -r apps/strands-agent/requirements-dev.txt
cp apps/strands-agent/.env.example apps/strands-agent/.env
```

Set a generated `STRANDS_SERVICE_TOKEN` of at least 32 characters in the private environment file and the same value in the worker. Configure `DEVICEOPS_URL` to the trusted backend origin. Use an AWS instance role or the normal SDK credentials/profile chain; credentials are not committed or sent to MCP.

```sh
apps/strands-agent/.venv/bin/python -m uvicorn main:app \
  --app-dir apps/strands-agent --env-file apps/strands-agent/.env \
  --host 127.0.0.1 --port 8081 --workers 1 --no-access-log
```

Bedrock routes return `503 credits_confirmation_required` unless `AWS_CREDITS_CONFIRMED=true`. Set this only after verifying usable credits in AWS Billing; it is an operator attestation, not a balance lookup.

One ASGI worker is required: its separate operation locks admit one investigation and one nested embedding request and responds `429 service_busy` to concurrent requests. The backend supplies durable queuing and retry scheduling. Do not expose this service publicly. Docker uses `Dockerfile.strands` and the same environment; the app listens on container port 8081.

`GET /healthz` is a process/configuration check. It deliberately reports `modelReady: "unverified"`; health checks do not invoke paid AWS models or establish model access. Verify AWS model entitlement separately before a live demonstration. Live provider verification is recorded separately.

## API boundaries

Both POST routes require `Authorization: Bearer <STRANDS_SERVICE_TOKEN>`.

`POST /investigate` accepts only:

```json
{"invocationId":"UUID", "incidentId":"UUID", "grantToken":"short-lived-backend-grant"}
```

The invocation starts a fresh Python runner and a scoped stdio MCP client. The Node command and argument list are trusted configuration (`DEVICEOPS_MCP_COMMAND` and JSON `DEVICEOPS_MCP_ARGS`), never request or model input. The default is the installed Node binary with `--import tsx` and the repository's absolute MCP entrypoint. The MCP subprocess receives only a minimal environment plus `DEVICEOPS_URL` and `DEVICEOPS_MCP_GRANT`; database and AWS environment credentials are excluded. Linux parent-death signaling prevents an MCP process outliving a killed invocation.

Available investigation tools: `get_incident_context`, `get_device_health`, `query_telemetry_logs`, `get_topology`, `search_manual`, `correlate_changes`, `get_action_capabilities`.

The result contains `summary`, `cause`, `evidenceIds`, `alternatives`, `uncertainty`, nullable `action`, `provider: "strands-bedrock"`, `modelId`, `usage: {inputTokens, outputTokens, modelCalls}`, and `toolCalls`. Actions are limited to `restart_service` or `restart_switch`, a UUID `targetDeviceId`, and empty `arguments`. The service requires successful incident-context retrieval and an action-capability lookup for the exact target before returning an action. The backend still revalidates evidence, identity, permitted capabilities, freshness and policy before any proposal is actionable.

`POST /embed` accepts `{"texts":["approved runbook text"]}` (1–16 nonempty strings, at most 4,000 characters each), and returns `{"vectors":[[...1024 numbers...]],"modelId":"amazon.titan-embed-text-v2:0","inputTokens":5}`. It requests normalized 1,024-dimensional Titan V2 embeddings and rejects missing provider usage, non-finite values, or unexpected dimensions. A failed batch returns an error, not partial or synthetic vectors. The backend must reserve budget before calling and conservatively settle failures, because some earlier batch items may already have been billed.

Generated schemas are in `schemas/`; `python export_schemas.py --check` detects drift. They are Python boundary contracts aligned to TypeScript's `DiagnosisSchema`; the TypeScript backend remains the authority for application state and policy.

## Budgets and failures

Defaults, which configuration can lower but cannot raise:

| Limit | Maximum |
| --- | ---: |
| Invocation elapsed time | 120 seconds |
| Model calls | 8 |
| MCP tool calls | 12 |
| Output tokens per model call | 2,000 |
| Cumulative input tokens | 120,000 |
| Cumulative output tokens | 8,000 |

Each model call reserves conservative serialized UTF-8 input size plus framing overhead and its allowed output, then reconciles provider-reported usage. Failed streams retain their reservation; missing usage blocks further inference. SDK and botocore model retries are disabled so retries cannot secretly multiply spend. These per-invocation caps complement the backend's monetary budget reservation; they are not an account-wide billing limit.

The outer runtime kills the invocation process on timeout/cancellation instead of abandoning a background inference thread. AWS may still bill a request already accepted before cancellation. Backend grants must expire independently.

Failures are explicit: `401 unauthorized`, `422 invalid_request`, `429 service_busy/budget_exhausted`, `502 provider_unavailable/invalid_provider_result`, or `504 invocation_timeout`. Responses and service logs do not include raw provider errors, grant tokens, or payloads. Provider/MCP failures never switch to mock reasoning. Any fixture demonstration is an explicit backend mode and remains labelled as such.

Nova Lite defaults to `us.amazon.nova-lite-v1:0` in `us-east-1`; US inference-profile routing can occur across supported US regions. Selected evidence is sent to Bedrock even with a local collector. Credentials and full device-network access stay outside model tools.

## Verify without AWS

```sh
apps/strands-agent/.venv/bin/python -m pytest apps/strands-agent/tests -q
apps/strands-agent/.venv/bin/python apps/strands-agent/export_schemas.py --check
```

Tests exercise the installed Strands agent/tool/structured-output loop with a deterministic provider stream, actual local stdio MCP, action-capability requirements, strict API contracts, authentication, credential isolation, per-call/cumulative budgets, timeout termination, malformed embeddings, and explicit failure behavior. Test doubles are test-only and cannot be selected through the production API.

`requirements.in` records direct dependency intent; `requirements.txt` pins the tested runtime dependency closure. Test dependencies are in `requirements-dev.txt`.

SDK references checked during implementation: [MCP lifecycle](https://strandsagents.com/docs/user-guide/concepts/tools/mcp-tools/), [structured output](https://strandsagents.com/docs/user-guide/concepts/agents/structured-output/), [hooks](https://strandsagents.com/docs/user-guide/concepts/agents/hooks/), [Bedrock provider](https://strandsagents.com/docs/user-guide/concepts/model-providers/amazon-bedrock/).

The service admits at most one investigation and one embedding request concurrently. This allows a scoped search tool to embed its query while the investigation waits for that tool; same-operation overlap is rejected. Both operations reserve backend budget independently.

## Explicit Gemini provider

See [the Gemini setup guide](../../docs/GEMINI.md). Install the locked requirements, select `STRANDS_MODEL_PROVIDER=gemini`, configure `GEMINI_API_KEY` privately and confirm `GEMINI_USAGE_CONFIRMED=true`. Gemini uses lexical retrieval; Titan embedding requests are disabled in this mode.
