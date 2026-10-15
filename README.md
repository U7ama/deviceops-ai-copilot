# DeviceOps — Evidence-backed incident investigation and recovery

DeviceOps helps operations teams investigate failing equipment, review evidence and recover safely. It connects device observations, topology, specialist AI investigations and human approvals in one workspace.

The backend controls which actions are allowed. A model recommendation cannot bypass permissions, approve its own proposal or mark an incident resolved without fresh recovery observations.

## What it does

- **Detect and group incidents:** normalized observations, telemetry drift detection and dependency-aware impact.
- **Investigate with evidence:** bounded Network, System and Power specialists, followed by a Critic review, using Strands and scoped MCP tools.
- **Review consequential actions:** exact proposal hashes, role restrictions, CSRF protection and idempotent decisions.
- **Verify recovery:** three fresh healthy observations across the affected devices before resolution; command acknowledgment alone is insufficient.
- **Collect field evidence:** mobile photo capture, checksums, quarantine scanning, PDF citations and confirmed device associations.
- **Analyze observations:** restricted container-based CSV statistics, charts and waveform spectra.
- **Reuse reviewed knowledge:** tenant-scoped incident history, runbooks and baselines.

## Dashboard

The dashboard provides Overview, Incidents, Rooms & Equipment, Approvals, Knowledge and Administration views. Start at `/operations`; incident links use `/operations?view=incidents&incident=<id>`. Existing v1 diagnosis, approvals, incidents and run timelines remain available.

The UI adapts the Kiranism dashboard foundation to DeviceOps, with responsive navigation, ten palettes and Light/Dark/System preferences. See [UI provenance and verification](docs/UI_MIGRATION.md).

## Architecture

![DeviceOps architecture](docs/diagrams/deviceops-architecture.png)

[Architecture and boundaries](docs/ARCHITECTURE.md) · [Project overview](docs/PROJECT_OVERVIEW.md) · [Editable diagram](docs/diagrams/deviceops-architecture.svg)

| Component | Responsibility |
| --- | --- |
| `apps/web` | Next.js dashboard, authentication and tenant-scoped v1/v2 APIs |
| `apps/worker` | Observation polling, detection, durable investigations and notification dispatch |
| `packages/operations` | Incidents, evidence, approvals, commands, recovery and model-budget accounting |
| `apps/strands-agent` | Bounded Python Strands reasoning with explicit Qwen or Bedrock provider selection |
| `apps/mcp` | Invocation-scoped evidence tools and the legacy read-only adapter |
| `packages/connectors` / `apps/edge` | Adapters, credential vault, discovery, collector and protocol simulator |
| `packages/db` | PostgreSQL migrations, tenant transaction context, row-level security and audit records |
| `infra/agentcore` | AgentCore packaging, bridge and restricted callback proxy |

## Local setup

Use Node **22.16.0**, npm and Docker Compose on Linux/WSL. Python 3.12 is needed for host-side Strands development. The local container build currently requires the prepared dependency image described in [hosting notes](infra/hosting/README.md).

```sh
npm ci
npm run demo:env
npm run demo:preflight
docker compose --env-file .env.demo -f compose.demo.yaml up -d postgres
docker compose --env-file .env.demo -f compose.demo.yaml run --build --rm migrate
docker compose --env-file .env.demo -f compose.demo.yaml run --rm seed
docker build -t deviceops-analysis:local apps/analysis-sandbox
docker compose --env-file .env.demo -f compose.demo.yaml -f compose.enterprise.yaml -f compose.media-scan.yaml up -d --build web worker
```

Open [localhost:3030](http://localhost:3030), use the seeded account and private generated `SEED_PASSWORD`, then open `/operations`. Seed only a disposable database: reseeding resets fixture accounts and legacy test data. Preserve volumes when stopping the stack.

Use **Operational Scenarios → Upstream switch failure** to inspect investigation, manager approval and verified simulator recovery. Fixture mode is deterministic and makes no model calls. Live reasoning requires explicit provider configuration and service access; see [Qwen setup](docs/QWEN.md) and the [operations runbook](docs/OPERATIONS_RUNBOOK.md).

The environment helper preserves existing local configuration. Scanner health is required for arbitrary photo uploads. See [mobile and acoustic setup](docs/ACOUSTIC_AND_MOBILE.md) and [notification workflows](https://github.com/U7ama/deviceops-automations).

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run contracts:check
npm run build --workspace @deviceops/web
```

[Browser verification instructions](docs/UI_MIGRATION.md) cover fixture-backed UI flows. [Recorded verification](docs/verification/) distinguishes simulator, local API, physical-phone and live-provider checks. Historical cloud recovery records do not establish current deployment availability.

Real equipment is read-only; recovery actions are restricted to enrolled simulators. Vendor compatibility is documented per adapter in [integration statuses](docs/INTEGRATIONS.md). Production fleet scale, high availability and regulated-environment certification are not established by these demonstrations. See [security controls](SECURITY.md) and the [threat model](THREAT_MODEL.md).

## Companion projects and third-party notices

[DeviceOps Mobile](https://github.com/U7ama/deviceops-mobile) provides the Expo technician client. [DeviceOps Automations](https://github.com/U7ama/deviceops-automations) contains signed n8n notification workflows.

Third-party dependencies retain their own licenses. The adapted dashboard components retain the [upstream UI notice](docs/licenses/kiranism-dashboard-MIT.txt).
