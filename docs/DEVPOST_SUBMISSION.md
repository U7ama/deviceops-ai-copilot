# DeviceOps: Autonomous Multi-Agent Operations & Incident Resolution for Enterprise Infrastructure

Submission copy for Professional Agents. Add the final public repository and video URLs, AWS Builder ID and testing instructions in Devpost. Publication and recording are separate completion steps.

## Elevator pitch
 
DeviceOps helps universities, healthcare, and enterprise teams investigate equipment failures with autonomous Strands sub-agents, multi-modal evidence, and policy-gated verified recovery.

## Inspiration

Whether in university lecture halls, hospital clinics, or enterprise facilities, operations teams manage vast fleets of network switches, telemetry displays, environmental sensors, and edge services. When critical equipment fails, a device appearing offline is frequently just a symptom of an upstream network or power issue. In mission-critical environments, such as a hospital patient-monitoring wing or a university during final exams, restarting shared infrastructure blindly without understanding its dependencies can cause catastrophic cascading outages. We wanted to connect proactive drift detection, multi-specialist investigation, physical evidence validation, strict human authorization, and verified recovery into a single dependable workflow.

## What it does

DeviceOps detects sustained telemetry drift, groups related incidents using stored topology, and coordinates an autonomous multi-agent investigation workflow. Specialized sub-agents (Network, System/Service, and Power/Thermal) evaluate scoped domain evidence in parallel; an independent Critic sub-agent rigorously audits the hypotheses for contradictions, evidence gaps, and blast radius before the backend evaluates any proposed recovery action.

Technicians can capture or choose incident photos in the existing mobile app and attach approved images, floorplans, PDFs and telemetry files. Relevant PDF pages are extracted and rendered with source citations. Approved CSV data can be analyzed inside a restricted disposable container, producing statistics and charts, including a bounded comparison of acoustic waveform spectra. Incident history, reviewed runbooks and metric baselines provide tenant-scoped context.

The backend owns execution policy. Critical or unknown dependency impact requires escalation. Eligible simulator actions use exact approval hashes, idempotent dispatch, fresh-evidence checks and independent recovery verification. Real equipment remains read-only.

## How we built it

Next.js, a TypeScript worker, PostgreSQL and pg-boss run locally. The Python Strands workflow runs on AWS Bedrock AgentCore using a direct S3 code bundle and calls Alibaba Cloud Qwen for inference. Scoped MCP tools retrieve local evidence through Cloudflare and a restricted loopback proxy; the backend validates invocation grants. Selected incident evidence travels to the cloud while the operational database and simulators remain local.

The recorded cloud recovery used Qwen3.7-Max. Bedrock model inference and Titan embeddings are separate optional integrations, not prerequisites for this demonstration. Local lexical retrieval supplies runbook context. Evidence parsing and generated analysis use restricted containers behind a local broker.

### The Hackathon Journey: From Copilot (v1) to Autonomous Operations (v2)

Both v1 and v2 were engineered and implemented 100% within the active hackathon window after the hackathon started. The architecture reflects our rapid, iterative problem-solving evolution:
- **Phase 1 (v1: Interactive Copilot):** We initially began building an interactive diagnostic copilot (`/diagnosis`, `/api/v1`) to help on-call staff query failing device state and retrieve manual excerpts. At this initial phase, we were not yet aware of the hackathon.
- **The Hackathon Discovery & Architectural Pivot:** Upon discovering the AWS / AI hackathon shortly afterward, we took on the challenge to push beyond a passive human-prompted assistant. Waiting for a human technician to notice an alert and type a query is fundamentally insufficient for mission-critical campus infrastructure. Equipment requires proactive drift detection, multi-agent domain expertise, and verified closed-loop remediation.
- **Phase 2 (v2: Autonomous Operations Platform):** Within the hackathon timeline, we re-architected DeviceOps into an autonomous resilience engine (`/operations`, `/api/v2`). We deployed our multi-specialist agents onto **AWS Bedrock AgentCore** backed by Alibaba Cloud Qwen (`qwen3.7-max`), implemented a restricted, authenticated reverse-tunnel proxy for on-premises device tools, added streaming EWMA anomaly detection (such as optical transceiver power loss), and enforced cryptographic manager approval hashes with fresh telemetry verification.
- The v1 technician assistant remains preserved in the repository as a manual diagnostic fallback, while v2 serves as our flagship autonomous operations submission.

## Challenges

Navigating AWS cloud access and model quotas was our most significant hurdle during the hackathon:

- **AWS Bedrock AgentCore Access and Service Quota Escalation**: Initially, access to the serverless AWS Bedrock AgentCore runtime was restricted in our account. Through persistent troubleshooting, submitting AWS Service Quota increase requests, and working directly with AWS Support chat, we successfully resolved the account boundaries and unlocked AgentCore deployment in us-east-1.
- **Model Inference Availability and the Alibaba Cloud Pivot**: While AgentCore was successfully unlocked, access and quota approval for native AWS Bedrock foundation model inference could not be granted in time for our account during the competition window. Rather than letting access blockers halt the project, we demonstrated architectural resilience: we deployed our Strands agents inside AWS Bedrock AgentCore while integrating Alibaba Cloud Model Studio (Qwen 3.7 Max and Flash) for live high-speed reasoning. We also preserved full architectural readiness for native Bedrock models once quotas are granted.
- **Offline Reliability and Bounded Runtimes**: External quota constraints reinforced the need for reliable local evaluation. We built a clearly labeled, deterministic fixture mode alongside our live AgentCore cloud path. This decoupled model inference from our local evidence pipeline, containerized sandbox analysis, and simulator recovery workflows.
- **Deep Document Extraction**: Enterprise equipment manuals are often dozens of pages long, with critical pinout diagrams located far beyond the cover page. We built bounded, relevance-based extraction and selected-page rendering so a diagram on page thirty can be delivered with an inspectable citation rather than overwhelming model context windows.

## Accomplishments

- Deployed the Strands workflow to AWS Bedrock AgentCore in `us-east-1` through direct S3 code deployment.
- Recorded automatic simulator service recovery through AgentCore and Qwen in **100.5 seconds**: investigation, backend-authorized restart, and three healthy observations before resolution. See `docs/verification/agentcore-bounded-recovery.json`.
- Verified end-to-end human manager approval lifecycle on the active AWS Bedrock AgentCore candidate runtime in **114.3 seconds**: multi-agent investigation, proposal generation with `approval_required` risk, pre-approval zero-command verification, authenticated manager API decision, simulator execution of `restart_switch`, and three healthy observation cycles to resolution. See `docs/verification/agentcore-switch-approval.json`.
- Separately verified manager-approved switch recovery on the local Strands/Qwen baseline path, with exact proposal-hash checks and recovery observations. See `docs/verification/qwen-recovery.json`.
- Preserved existing operational scenarios while adding deterministic dependency-impact enforcement.
- Implemented 8 new official protocol and vendor API adapters (Extron, Axis, Sony, NETIO, Barco, Biamp, Crestron, Zoom), expanding active catalog integrations to 12 (mock/protocol-tested; physical hardware compatibility unverified).
- Created a floating toast notification system providing visual feedback across tested primary routes (diagnostics, approvals, webhook retries, runs, and session operations).
- Demonstrated optical receiver drift without claiming a validated failure forecast.
- Verified actual isolated statistics/chart generation, protected photo/PDF processing, and acoustic spectrum FFT analysis.
- Added selected-page image citations and a synthetic long-manual verification fixture.
- Built and validated mobile evidence contracts and candidate release preview APK (`deviceops-preview.apk`).
- Made simulated, live, unavailable, and unverified behavior explicit across all layers.

Use the latest verification reports (`docs/verification/agentcore-switch-approval.json`, `docs/verification/agentcore-bounded-recovery.json`, and `docs/verification/qwen-recovery.json`) for audit records; passing tests are evidence of the tested scope, not production certification.

## What we learned

Agent reasoning and execution authority need separate boundaries. A convincing diagnosis is insufficient without current evidence, scoped tools, explicit permissions and a verifiable recovery outcome. Explicit model selection and citation validation improve traceability, but they do not eliminate hallucinations. Backend authorization and fresh evidence checks remain necessary.

## What's next

Independently verify optional AWS Bedrock adapters, conduct field verification on physical Android hardware across heterogeneous networks, and expand device-specific retrieval and field evidence capture. Fleet scale testing, seasonal learning, high availability and clinical deployment are outside this hackathon release.

## Disclosure for the final submission

All project work was built within the hackathon submission period, as confirmed by the project author. The preserved v1-to-v2 history describes that development journey. Frameworks, SDKs and other third-party dependencies remain subject to their licenses; disclose any incorporated pre-existing work separately if applicable.

The demonstration uses synthetic telemetry and simulated remediation. Real equipment is read-only, and physical vendor compatibility is unverified. The catalog contains 12 mock/protocol-tested adapters and 45 planned entries, plus a separate HTTP simulator. Photo/PDF processing, CSV charts and acoustic spectra are local operations; spectra are not a validated hardware-fault diagnosis. Mobile capture, on-device SHA-256 integrity hashing, reverse-bridge upload, ClamAV antivirus quarantine scanning, and technician device confirmation are verified on an attached physical Android handset.

The cloud service-recovery and cloud manager-approval records (`docs/verification/agentcore-bounded-recovery.json` and `docs/verification/agentcore-switch-approval.json`) document tested simulated infrastructure remediation on AWS Bedrock AgentCore. Cloud cancellation and repeated-request cleanup remain limitations documented in `docs/verification/AGENTCORE_HARDENING.md`. No production certification, unlimited quota, or guaranteed zero cost is claimed.

## Testing Instructions (for Devpost "Testing Instructions" field)

To evaluate the DeviceOps autonomous operations platform locally with zero cloud costs, zero external API keys, and 100% deterministic reproducibility:

```sh
# 1. Clone repo and install dependencies
npm ci

# 2. Generate private environment configuration and run preflight checks
node scripts/hackathon-env.mjs
node scripts/hackathon-preflight.mjs

# 3. Launch database, run migrations, and seed demo accounts
docker compose --env-file .env.hackathon -f compose.hackathon.yaml up -d postgres
docker compose --env-file .env.hackathon -f compose.hackathon.yaml run --build --rm migrate
docker compose --env-file .env.hackathon -f compose.hackathon.yaml run --rm seed

# 4. Build sandbox analysis image and start web UI + worker
docker build -t deviceops-analysis:local apps/analysis-sandbox
docker compose --env-file .env.hackathon -f compose.hackathon.yaml -f compose.enterprise.yaml -f compose.media-scan.yaml up -d --build web worker
```

**Accessing the Demonstration:**
1. Open http://localhost:3030 in your browser.
2. Sign in with `usamaaslam8726@gmail.com` and the `SEED_PASSWORD` printed to the console during the seed step (also available in your private `.env.hackathon`).
3. Navigate to `/operations`.
4. Trigger the demo scenarios:
   - **Upstream switch failure**: Injects switch fault, triggers multi-specialist investigation, generates a restart proposal requiring manager approval, enforces 0 pre-approval commands, executes simulator restart upon approval, and verifies 3 consecutive healthy observation cycles before resolving.
   - **Service hang**: Demonstrates autonomous backend-authorized recovery without human intervention.
5. All live verification records (including AWS Bedrock AgentCore multi-agent runs) are available under `docs/verification/`.

