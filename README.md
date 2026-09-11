# DeviceOps — Autonomous Multi-Agent Operations & Incident Resolution for Enterprise Infrastructure

DeviceOps is an evidence-backed autonomous operations and incident resolution platform for enterprise infrastructure. Built with AWS Strands Agents, it proactively detects telemetry drift, investigates incidents with domain specialists, requests human approval for disruptive actions, and verifies fresh telemetry before resolving incidents.

This repository contains a working synthetic incident workflow and a private Strands/Bedrock service. **Fixture mode is the default and uses deterministic logic, with no live AI claim.** Live reasoning requires verified AWS credits, model access, and configured credentials. Vendor compatibility is reported per connector; the full 57-entry catalog includes planned integrations.

## Run the local demonstration

Prerequisites: Node **22.16.0**, Docker with Compose, and Linux/WSL. Python 3.12 is needed only for host-side Strands tests or a host-run agent.

```sh
npm ci
node scripts/hackathon-env.mjs
node scripts/hackathon-preflight.mjs
docker compose --env-file .env.hackathon -f compose.hackathon.yaml up -d postgres
docker compose --env-file .env.hackathon -f compose.hackathon.yaml run --build --rm migrate
docker compose --env-file .env.hackathon -f compose.hackathon.yaml run --rm seed
docker build -t deviceops-analysis:local apps/analysis-sandbox
docker compose --env-file .env.hackathon -f compose.hackathon.yaml -f compose.enterprise.yaml -f compose.media-scan.yaml up -d --build web worker
```

Open [localhost:3030](http://localhost:3030), sign in with `manager@alpha.test` and the generated `SEED_PASSWORD` from private `.env.hackathon`, then open `/operations`. The seed command also prints the demo credentials locally. Seed only a disposable demo database; reseeding resets fixture accounts and legacy test data.

Use **Demo scenarios → Upstream switch failure**. The worker detects the fault and investigates. Review the exact switch-restart proposal, approve it, and observe recovery verification. Also try permitted service recovery, authentication failure, stale/conflicting sources, and acknowledged-but-failed recovery.

The enterprise overlay adds the private analysis broker. The media-scan overlay adds ClamAV for arbitrary photo uploads; allow its health check to pass before capture testing. Images remain quarantined until scanning and parsing succeed. See [mobile and acoustic setup](docs/ACOUSTIC_AND_MOBILE.md).

The standalone Compose file uses a separate project and private database volume. It binds the UI only to localhost and is a development demonstration. Stop it with the same Compose command followed by `down`; omit `--volumes` to preserve evidence.

See [the hackathon runbook](docs/HACKATHON.md) for host-run commands, optional Strands and notification setup, scenario expectations, submission work, and remaining verification gates.

## Architecture

![DeviceOps architecture](docs/diagrams/deviceops-architecture.png)

[Diagram explanation and source](docs/ARCHITECTURE.md) · [SVG](docs/diagrams/deviceops-architecture.svg) · [PDF](docs/diagrams/deviceops-architecture.pdf)

## Implementation map

| Component | Responsibility |
| --- | --- |
| `apps/web` | Existing authentication and API v1; new `/operations` UI and scoped API v2 |
| `packages/operations` | Durable incidents, observations, approvals, evidence validation, commands, recovery, grants and model-budget ledger |
| `apps/worker` | Continuous polling/detection, durable investigation jobs and notification dispatch |
| `apps/strands-agent` | Bounded Python Strands/Bedrock reasoning and Titan embeddings; read-only MCP tools |
| `apps/mcp` | Invocation-scoped tool proxy; separate legacy read-only adapter |
| `packages/connectors` / `apps/edge` | Normalized adapters, local credential vault, bounded discovery, collector and protocol simulator |
| `packages/db` | PostgreSQL migrations, tenant transaction context, RLS and audit records |

The existing diagnosis workflow remains available. Historical screenshots and architecture documents describe that earlier workflow; they are not proof of the new autonomous path. The mobile companion remains separate and is not yet the required operational-approval client.

## Verification and boundaries

```sh
npm run typecheck
npm test
npm run build --workspace @deviceops/web
python3 -m venv apps/strands-agent/.venv
apps/strands-agent/.venv/bin/pip install -r apps/strands-agent/requirements-dev.txt
apps/strands-agent/.venv/bin/python -m pytest apps/strands-agent/tests -q
apps/strands-agent/.venv/bin/python apps/strands-agent/export_schemas.py --check
```

The implementation session exercised the operation workflow against native PostgreSQL 16 and tested the installed Strands SDK using deterministic model streams and a real local MCP transport. Check [the runbook](docs/HACKATHON.md) for recorded verification and unresolved checks. No live Bedrock evaluation, AWS deployment, hardware certification, or public submission is implied by passing offline tests.

Read [integration statuses](docs/INTEGRATIONS.md), [the Strands service contract](apps/strands-agent/README.md), and [reviewable AWS infrastructure](infra/hackathon/README.md). Credentials remain outside model tools. Local deployment still sends selected evidence to Bedrock when live reasoning is enabled. Real device writes remain disabled for this submission.

## License and provenance

MIT; see [LICENSE](LICENSE). Third-party dependencies retain their own licenses. The root Git commit is `eadfcae9814ec5e10dc9a6361b48c419c3aa7ddb`, dated August 11, 2026, 17:43:27 PKT. Disclose incorporated pre-existing work in the submission; a commit date alone is not an eligibility ruling.

Companion repositories: [DeviceOps Mobile](https://github.com/U7ama/deviceops-mobile) and [DeviceOps Automations](https://github.com/U7ama/deviceops-automations). They have their own setup and verification boundaries.

Use [Gemini through Strands](docs/GEMINI.md) when selecting Google inference explicitly. Bedrock remains supported; no automatic provider fallback is enabled.

## Five-pillar release

See [enterprise release and verification](docs/ENTERPRISE_RELEASE.md) for specialist investigations, proactive anomalies, photo/PDF evidence, restricted analysis, memory, deployment settings and the recording script. Open the Enterprise tab in `/operations`. AWS adapters remain separately gated by actual service access.

Recording and submission drafts: [word-for-word script](docs/RECORDING_SCRIPT.md) · [Devpost narrative](docs/DEVPOST_SUBMISSION.md). Both distinguish the verified fixture deployment from pending live-provider verification.
