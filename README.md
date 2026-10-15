# DeviceOps — Autonomous Multi-Agent Operations & Incident Resolution for Enterprise Infrastructure

> **Agents for Humans Hackathon Submission**  
> *Autonomous infrastructure diagnosis, evidence-backed multi-specialist investigation, and closed-loop verified recovery.*

---

### ⚡ Executive Summary

* **The Problem:** Universities, healthcare networks, and enterprise facilities manage hundreds of network switches, telemetry displays, and edge services. When critical equipment fails, on-call engineers are inundated with alerts and forced into manual triage under severe pressure. In high-stakes environments—like hospital clinics or university lecture halls—an offline display is often just a symptom of an upstream network switch or power failure. Blindly power-cycling shared infrastructure without understanding dependencies causes cascading outages, interrupts critical operations, and destroys forensic logs.
* **Who It's For:** Higher education campuses, healthcare and hospital networks, and enterprise facilities operations teams managing mixed fleets of IoT hardware, networking gear, and mission-critical edge services.
* **Why It Matters:** DeviceOps transforms reactive alert firefighting into an autonomous, evidence-backed workflow. Built with **AWS Strands Agents** and deployed on **AWS Bedrock AgentCore** with **Alibaba Cloud Qwen** inference, it proactively detects telemetry drift before full outages occur, routes investigations across specialized sub-agents (Network, System, Power, and Critic), enforces strict manager approval for disruptive actions, and requires 3 consecutive fresh healthy observations across all affected devices before resolving incidents.

---

This repository contains a working synthetic incident workflow, a private Strands service, and verified live multi-agent reasoning with Alibaba Cloud Qwen (`qwen3.7-max` and `qwen3.7-plus`; see [Qwen documentation](docs/QWEN.md)). **Fixture mode is the default and uses deterministic logic, with no live AI claim.** Live Bedrock reasoning requires verified AWS credits and model access. Vendor compatibility is reported per connector; the full 57-entry catalog includes planned integrations.

## Run the local demonstration

The dashboard uses the Kiranism starter's UI foundation with DeviceOps workflows.
See [UI migration and verification](docs/UI_MIGRATION.md) for provenance, themes,
and fixture-backed browser checks.

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

Open [localhost:3030](http://localhost:3030), sign in with `usamaaslam8726@gmail.com` and the generated `SEED_PASSWORD` from private `.env.hackathon`, then open `/operations`. The seed command also prints the demo credentials locally. Seed only a disposable demo database; reseeding resets fixture accounts and legacy test data.

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
| `infra/agentcore` | AWS Bedrock AgentCore serverless microVM runtime, deployment scripts, and loopback tool proxy |
| `apps/mcp` | Invocation-scoped tool proxy; separate legacy read-only adapter |
| `packages/connectors` / `apps/edge` | Normalized adapters, local credential vault, bounded discovery, collector and protocol simulator |
| `packages/db` | PostgreSQL migrations, tenant transaction context, RLS and audit records |

### The Hackathon Engineering Journey: From Copilot (v1) to Autonomous Operations (v2)

**Both v1 and v2 were engineered 100% within the active hackathon dates.** Their presence reflects a deliberate two-phase technical evolution:

1. **Phase 1 (v1 — Interactive Copilot):** Development initially began on an interactive diagnostic copilot (`/diagnosis`, `/api/v1`) designed for on-call engineers before we discovered the hackathon. This workflow allowed technicians to select a device, query technical manuals, and ask questions.
2. **The Hackathon Discovery & Pivot:** Upon discovering the AWS / AI hackathon shortly afterward, we realized that passive, prompt-based chatbots fail enterprise infrastructure requirements. Unattended equipment demands autonomous drift detection, topology-aware multi-agent investigation, and verified closed-loop recovery.
3. **Phase 2 (v2 — Autonomous Operations Platform):** We took on the hackathon challenge and engineered v2 (`/operations`, `/api/v2`): a serverless **AWS Bedrock AgentCore** multi-specialist system running on Alibaba Cloud Qwen (`qwen3.7-max`), backed by real EWMA telemetry drift detection, zero-trust hybrid loopback tools, cryptographic approval hashes, and multi-sample recovery verification.

The v1 diagnostic workflow is preserved as a manual fallback and technician interface, while v2 serves as the primary autonomous hackathon submission.


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

The implementation session exercised the operation workflow against native PostgreSQL 17 and tested the installed Strands SDK using deterministic model streams and a real local MCP transport. Check [the runbook](docs/HACKATHON.md) for recorded verification and unresolved checks. No live Bedrock evaluation, AWS deployment, hardware certification, or public submission is implied by passing offline tests.

Read [integration statuses](docs/INTEGRATIONS.md), [the Strands service contract](apps/strands-agent/README.md), and [reviewable AWS infrastructure](infra/hackathon/README.md). Credentials remain outside model tools. Local deployment still sends selected evidence to Bedrock when live reasoning is enabled. Real device writes remain disabled for this submission.

## License and provenance

MIT; see [LICENSE](LICENSE). Third-party dependencies retain their own licenses. The root Git commit is `eadfcae9814ec5e10dc9a6361b48c419c3aa7ddb`, dated August 11, 2026, 17:43:27 PKT. All code for both Phase 1 (v1) and Phase 2 (v2) was authored and committed 100% within the official hackathon window following the event kickoff.

Companion repositories: [DeviceOps Mobile](https://github.com/U7ama/deviceops-mobile) and [DeviceOps Automations](https://github.com/U7ama/deviceops-automations). They have their own setup and verification boundaries.

Use [Qwen through Strands](docs/QWEN.md) for Alibaba Cloud Model Studio inference. Bedrock remains supported; no automatic provider fallback is enabled.

## Five-pillar release

See [the hackathon engineering overview](docs/HACKATHON.md) for specialist investigations, proactive anomalies, photo/PDF evidence, restricted analysis, memory, deployment settings and the recording script. Open the Enterprise tab in `/operations`. AWS adapters remain separately gated by actual service access.

Recording and submission drafts: [word-for-word script](docs/RECORDING_SCRIPT.md) · [Devpost narrative](docs/DEVPOST_SUBMISSION.md). Both document the verified live Alibaba Qwen recovery rehearsals and clearly distinguish verified local operations from hardware and AWS deployment boundaries.

## Operations navigation

Start at `/operations?view=overview`. **Incidents** contains findings, uploads, specialist progress, acoustic/CSV analysis, approvals and recovery. **Rooms & Equipment** contains inventory and topology. **Approvals** lists v2 proposals, **Knowledge** provides memory and runbooks, and **Administration** contains service status, detector controls, discovery and integrations.

Deep links use `/operations?view=incidents&incident=<id>`. Existing `/incidents` and `/approvals` routes retain the v1 workflow. Demo scenarios are synthetic and manager-only. Light/Dark/System preferences are available; System follows browser-reported preferences. See [Architecture](docs/ARCHITECTURE.md) and [diagrams](docs/diagrams/).
