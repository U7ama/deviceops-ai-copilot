# DeviceOps architecture

![DeviceOps architecture](diagrams/deviceops-architecture.png)

[High-resolution PNG](diagrams/deviceops-architecture.png) · [Editable SVG](diagrams/deviceops-architecture.svg) · [Single-page PDF](diagrams/deviceops-architecture.pdf)

The PNG is 3600 × 2640 pixels, intended for the Devpost architecture attachment and presentation slides. SVG preserves scalable text and shapes. The diagram reflects the repository on September 8, 2026; it describes logical data flow, not a claim that the current Docker image has been rebuilt or a hosted AWS deployment exists.

## How to read it

1. **Collect.** The Node.js edge collector probes enrolled LAN devices and the standalone HTTP simulator, normalizes observations and submits them through the scoped API. Its local encrypted vault holds device credentials; its journal persists observations and command intent. The worker also runs separate built-in synthetic demo scenarios; those do not pass through the edge collector.
2. **Detect.** The TypeScript worker detects incidents and groups related device failures using explicit topology. PostgreSQL stores operational records and pg-boss jobs. The API and worker exchange durable state through the database; the vertical arrow labeled persisted state is not a direct API-to-worker network call.
3. **Investigate.** The worker calls the private Python/FastAPI service. AWS Strands orchestrates Gemini inference and seven read-only MCP tools: `get_incident_context`, `get_device_health`, `query_telemetry_logs`, `get_topology`, `correlate_changes`, `search_manual`, and `get_action_capabilities`. The stdio MCP subprocess calls the DeviceOps tool API with a short-lived invocation grant. Results return along the request paths; response arrows are omitted for clarity.
4. **Authorize and act.** Strands returns a structured proposal. Backend policy checks evidence freshness and target capabilities. Only allowed simulator service restarts can run automatically; switch restarts require a manager approval tied to the exact proposal hash. The policy/execution/verification box represents backend modules, not a separate deployed microservice. Built-in simulator actions execute in backend state; standalone simulator actions travel through collector command polling and acknowledgement.
5. **Verify and report.** Command acknowledgement is not proof of recovery. Three fresh post-command healthy samples are required; continued failure escalates. The worker persists the report and dispatches notifications through local n8n/Mailpit. Signed callbacks acknowledge delivery through the API and never authorize device actions.

## Model and integration boundaries

- Gemini 3.7 Flash is an external Google API used through AWS Strands, not hosted on Amazon Bedrock. Four synthetic scenarios have passed with real Gemini reasoning; quota throttling continues to block the complete live failed-recovery scenario.
- Gemini mode uses lexical runbook retrieval. Bedrock Nova and Titan embedding routes exist but actual AWS requests remain account-blocked. The dotted path is optional and is not an automatic fallback. Titan is available to the Bedrock configuration; Gemini-plus-Titan is not currently wired as a supported mode.
- The 57-entry integration catalog contains four implemented adapters: Ping, SNMP system, SNMP switch ports, and PJLink. The separate HTTP simulator adapter is outside that count. Remaining catalog entries are planned; physical device/vendor compatibility is not established by simulator tests. Physical and cloud remediation are disabled.
- PostgreSQL is the actual persistence and job store. No separate Redis, managed vector database, AWS IoT Core, or AgentCore deployment is implied.

## Evidence and maintenance

Source references: `apps/worker/src/index.ts`, `packages/operations/src/{index,domain,store,provider,embeddings}.ts`, `apps/mcp/src/operations.ts`, `apps/strands-agent/{agent,config,runtime}.py`, `apps/edge/README.md`, and the companion automation workflow. Current test results and external blockers are recorded in [Live provider verification](LIVE_PROVIDER_VERIFICATION.md).

Regenerate the SVG with `python3 docs/diagrams/build_architecture.py`. Export the SVG with a browser or vector editor to refresh PNG/PDF after architecture changes. Do not remove boundary labels unless new verification supports the changed claims.
