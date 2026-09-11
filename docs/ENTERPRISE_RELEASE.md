# Five-pillar hackathon release

This release extends the existing operations workflow. It targets non-clinical infrastructure and uses explicit synthetic fixtures for local verification. Real-device remediation remains disabled.

## Running the local demonstration

1. Apply migrations through `npm run db:migrate` using the intended database configuration. `0003_enterprise.sql` adds tenant-isolated feature records and per-tenant invocation uniqueness. Existing operational data is preserved.
2. Build `deviceops-analysis:local` with `docker build -t deviceops-analysis:local apps/analysis-sandbox`.
3. For native development set `OPS_SANDBOX_PROVIDER=local-container`; only the trusted worker/broker requires Docker access. Generated code runs in separate containers with no network, credentials, application mounts or Docker socket.
4. For Docker use `compose.hackathon.yaml` plus `compose.enterprise.yaml`. The private sandbox broker holds the Docker socket; never publish its port. Web and worker communicate through a private authenticated endpoint and share the existing evidence volume.
5. Set `OPS_APPROVED_FIXTURE_HASHES` to the SHA-256 values in `fixtures/enterprise/manifest.json` for these original MIT synthetic fixtures. For arbitrary uploads configure `MEDIA_CLAMAV_HOST`. An unscanned upload remains unavailable.
6. Choose `OPS_AGENT_MODE=fixture`, `gemini`, or `bedrock` explicitly. Set `OPS_INVESTIGATION_WORKFLOW=specialists` for the bounded Strands workflow. Complete the existing provider usage-confirmation configuration for live calls.
7. Open `/operations`, select **Enterprise**, replay the synthetic detector, enable investigation triggers, and replay again to create a proactive incident. Upload the rack image, PDF and CSV; confirm the incident device association. Approved CSV analysis returns statistics and a chart.

Fixture mode preserves the existing deterministic diagnosis behavior. It does not pretend to execute specialist model calls. Specialist tests use the installed Strands loop with deterministic provider streams; live provider results must be identified separately.

## Implemented boundaries

- Supervisor routes to relevant network, system/service and power/hardware specialists; critic findings cannot authorize execution. Specialists receive shared evidence with no execution tools or credentials. The workflow has no recursive delegation and runs specialists sequentially, below the two-call concurrency ceiling.
- The specialist workflow permits at most 12 model calls, 24 evidence-tool calls, 120k input tokens, 12k output tokens and 180 seconds. Original single-agent limits remain unchanged. Backend cancellation is checked before each model call; in-flight calls can finish but their results cannot authorize cancelled work.
- Streaming EWMA, sustained thresholds and rising trends support temperature, memory, power and downward optical received-power gauges. Optical thresholds are configurable per device; the default -10 dBm is a synthetic demonstration setting. Unsupported metric units are ignored. Counter metrics are not accepted by these initial detectors. A source change creates a separate baseline. Warm-up requires 48 samples and alerts require three distinct anomalous sample windows. Cooldown is five minutes.
- Photo normalization and PDF extraction/rendering occur inside the restricted parser container. Models receive bounded approved previews and page text. Incident keywords rank excerpts across up to 500 extracted pages; at most five 4,000-character excerpts enter context with original page numbers. This lexical ranking does not establish diagram comprehension or OCR coverage.
- Sandboxed analysis accepts approved incident artifact IDs, logs script/input hashes, limits jobs to two per incident, and returns untrusted results. Local limits are one CPU, 256 MiB, 64 PIDs, 30 seconds, 20 MiB input, 1 MiB text per stream and three exported files. A broker deadline or unexpected worker interruption can leave the result unknown; jobs are not automatically replayed.
- Incident memory searches factual completed outcomes, reviewed runbooks and versioned metric baselines. Retired runbooks disappear from retrieval. Existing optional Titan-assisted runbook retrieval remains available through the original search tool; the new memory view explicitly reports lexical retrieval. No seasonal-learning claim is made.
- Controls, device criticality, maintenance metadata, exact approval hashes, simulator restrictions, idempotent dispatch and recovery verification remain deterministic backend decisions.

## AWS adapters and cost

`agentcore_app.py` provides the IAM-fronted Runtime HTTP entrypoint; `STRANDS_TRANSPORT=agentcore` selects its bridge. The standalone entrypoint must never be exposed publicly outside AgentCore authentication. `AGENTCORE_RUNTIME_ARN` is deployment configuration, never model input.

The Code Interpreter adapter checks sandbox networking, absence of filesystem attachments and a role without identity permissions before starting a session. Its returned AWS stream is not a verified exported-chart implementation; keep it marked unverified until an actual service test and artifact handling check pass. Local container execution is the verified demonstration path.

`OPS_EVIDENCE_BUCKET` selects private encrypted S3 object storage. Local evidence storage is the verified path; S3 upload/read/delete requires separate live verification. AWS credentials stay in the object broker, never in generated-code containers.

On September 9, read-only checks again returned AgentCore Runtime quota **0** and Nova authorization **NOT_AUTHORIZED** in `us-east-1` and `us-east-2`. No AWS resource was created for this release check. Keep the $50 total AWS ceiling and the $10 verification allocation; neither application reservations nor billing alarms are a hard infrastructure spending stop.

## Verification record

Baseline before changes: 86 TypeScript tests, 45 Python tests, and 14 API/PostgreSQL checks passed. The previously reported MCP tenant argument issue is already fixed: unknown arguments are rejected before backend access.

New local evidence:

- 10/10 enterprise API checks: controls, replay, proactive incident, photo/PDF/CSV processing, cross-tenant rejection, association confirmation, unscanned rejection, isolated chart, PostgreSQL RLS and cancellation.
- Six sandbox checks: statistics/chart; denied network/credentials/host mounts; traversal rejection; execution timeout; excess output; container cleanup.
- Installed Strands supervisor/specialist/critic loop tests, critic escalation, cancellation before model reservation and optional AWS adapter boundaries.

Local log files are under `/tmp/deviceops-enterprise-*`; they are not submission artifacts. `.data/enterprise-verification.json` records the isolated integration results. Final suite, build, image, browser and provider results are recorded below.

## Recording sequence (under five minutes)

- **0:00–0:25:** Problem and boundaries: campus infrastructure, synthetic demonstration, real equipment read-only.
- **0:25–1:10:** Replay normal temperature followed by drift; show baseline, trend and proactive incident. Explain that this detects drift rather than forecasting an exact failure time.
- **1:10–2:05:** Show a verified specialist investigation and critic findings. Display actual provider labels, evidence gaps and shared usage. If live inference is unavailable, identify the offline test evidence explicitly.
- **2:05–3:10:** Show scanned rack photo and cited synthetic manual; confirm device association. Analyze approved CSV and show the generated chart.
- **3:10–4:15:** Demonstrate the existing switch-outage manager approval, exact proposal hash, one simulator command and sustained recovery. The proactive healthy-device example should not propose a restart.
- **4:15–4:45:** Retrieve prior incident and reviewed runbook, then show cancellation and tenant boundaries.
- **4:45–5:00:** Architecture and limitations: AWS Strands, provider flexibility, available versus unverified AWS adapters, and repository.

## Draft submission copy

**DeviceOps — Autonomous Multi-Agent Operations & Incident Resolution**

DeviceOps is an evidence-backed autonomous operations and incident resolution platform for campus and facilities teams. Built with the AWS Strands Agents SDK, it combines multi-specialist reasoning, proactive telemetry drift detection, approved visual/document evidence, isolated Python analysis and tenant-scoped organizational memory.

The backend owns authorization: real equipment is read-only, simulator actions follow deterministic policy, shared-switch recovery requires human approval, and command acknowledgement does not count as recovery. The demonstration uses synthetic telemetry and original staged fixtures. Provider access and live verification are reported separately from local test results.

Before publication, supply the verified deployment/testing instructions, current architecture image, public MIT repository, AWS Builder ID and recorded video. Do not claim all 57 catalog entries are implemented integrations.

### Live specialist probe — September 9

One actual Gemini specialist investigation reached the provider and stopped after about 13 seconds with HTTP 503 (`ServerError`). It escalated with no diagnosis and zero remediation commands. No automatic retry was made. This does not establish a successful live specialist workflow; offline Strands tests and local media/sandbox/API tests remain the verified evidence. The isolated ledger retained the conservative $0.27 reservation because actual usage was unavailable.

The production build passed after the Next.js environment type correction. Desktop and mobile browser checks passed after correcting a mobile overflow issue.

### Deployed port-3030 verification

The running web and worker source hashes matched the current operations, artifact, sandbox, MCP and Enterprise UI files. The worker initially lacked fixture hashes; the verified three-file manifest was configured and the worker recreated. The manually applied enterprise SQL was reconciled into the migration ledger only after checking its columns, indexes, forced tenant RLS and application grants. The standard migration command then passed.

All **10/10 enterprise checks passed against the deployed Docker stack on port 3030**, including actual broker-to-container image/PDF processing and CSV/chart execution. The original **14/14 API checks** and MCP grant regressions passed against the isolated current-source stack. Desktop/mobile Playwright checks passed against the production build. TypeScript: **91 passed**; Python: **50 passed**; workspace typecheck and production build passed.

Deployment mode remains **fixture** and no Strands service is active in this stack. Setting the workflow to specialists does not enable live inference. The new live specialist probe remains blocked by the observed provider HTTP 503; AWS Runtime quota and Nova authorization are separately blocked.

### Strands image packaging

The refreshed `deviceops-strands:local` image is `sha256:985f6adf62778d0d2a5e831c1adb6880dce21c158e9c23807e122d46f9232c59`. Network timeouts prevented a clean dependency download, so this local build reused the prior dependency image after verifying the pinned Python requirements were unchanged, then copied current source and manifests. Python dependency consistency, exported schema checks, Strands imports and MCP module imports passed. Seven critical source/dependency file hashes matched the working tree. This records a verified local image refresh; a clean dependency-install build remains to be repeated when package downloads are available. The repository's `Dockerfile.strands` remains the clean-build recipe.

This image is prepared but not started in the port-3030 fixture stack. A successful new live specialist investigation and the two combined recording rehearsals remain release gates before describing the complete five-pillar workflow as live.

### Optical and dependency extension

The Enterprise view now includes a stored-topology map, device impact counts, optical-loss replay, a synthetic critical-campus scenario and manager review of simulator criticality. Impact traverses transitive dependencies with cycle/duplicate protection. Critical, unknown or maintenance impact blocks proposals and is checked again before dispatch. The policy version is `2026-09-09.dependency.2`; old approval hashes cannot bypass the new policy. The capability response also reports impact and withholds actions requiring escalation.

The original floorplan PNG passes the same checksum, fixture-review, isolated parsing and technician-association flow as the other evidence. It is a staged elevation, not an asserted HVAC diagnosis. See `fixtures/enterprise/README.md` for interpretation and restoring the critical-device scenario. Waveform CSV spectrum analysis and mobile incident photo capture were added in the subsequent release; WAV/microphone ingestion and load testing remain deferred.

### Latest extension verification — September 9

- 96 TypeScript tests and 50 Python tests passed; workspace typecheck and final production build passed. All four original MCP grant/scope checks passed.
- Original 14 operational checks passed. Their setup now explicitly classifies previously unclassified legacy simulators through the manager policy API; it preserves real equipment and existing critical/unknown classifications.
- 13 enterprise checks passed against the deployed port-3030 stack, including optical replay, four-file evidence processing, sandbox chart generation and a complete critical-dependency escalation with zero commands.
- Desktop/mobile browser checks passed, including the dependency map and optical replay. Five deployed source/fixture hashes matched the current working tree. All three checkpoint branches remain unchanged.
- A new bounded Gemini probe returned HTTP 401 (`provider_access_denied`), escalated and dispatched zero commands. The earlier HTTP 503 is historical, not the current observed failure. Only the deployment file contained a configured Gemini key in the checked repository locations. Live automation remains disabled pending a privately updated, working key.
- The conservative $0.27 reservation was retained. The isolated testing ledger now records $1.785369 spent/reserved accounting, $0 currently reserved and a $2 limit; this is application accounting, not a provider invoice. No AWS resource was created.
- Clean dependency-install builds again stalled at npm installation. The matching existing dependency manifests were verified and local images refreshed. This does not count as a clean install build.

Current deployed web image: `sha256:dad690249baf001d87e4fd0b725af6571c024f492fc43c5f71cde1dadc7b54f2`. Prepared Strands image: `sha256:a48bef70f2628ff569abb2f27375e29772f701af5fbfff518ff6f848b923b700` (not running in the fixture stack). Machine-readable evidence: `docs/verification/2026-09-09-feature-extension.json`.

For recording, show optical loss and dependency impact in Enterprise, then upload the synthetic floorplan/manual/CSV and show the actual isolated chart. Identify fixture investigations explicitly. Successful live specialist inference, combined live recording rehearsals and clean dependency installation remain open; AWS adapters remain independently unverified or access-blocked as previously recorded.

### Selected-page PDF release follow-up

Relevant PDF pages now render inside the restricted parser container. At most two pages are selected from the bounded text index. Previews begin at 1200 pixels and downscale as needed to remain below 100,000 base64 characters each. The browser shows original page numbers; Strands receives explicit artifact/page references in image order. Image bytes are removed from the text context, and at most two images enter the vision call.

The original 30-page manual fixture proves actual page-30 rendering. Existing uploaded artifacts are not silently reprocessed; upload the new fixture to demonstrate the new behavior. Seven real-container checks passed, including rendering, network/credential isolation, traversal rejection, timeout, output limits and cleanup. All 96 TypeScript tests, 51 Python tests, workspace typecheck and production build passed. Fourteen enterprise API checks passed on the isolated stack and again on the deployed port-3030 stack. Desktop/mobile browser checks passed with page 30 displayed; the test now obtains its incident from its own tenant rather than a shared report file. Four deployed source/fixture hashes matched current files.

A model-list authentication recheck still returned Gemini HTTP 401; no inference tokens were requested. Live investigations remain disabled. A successful live specialist investigation and combined live rehearsal are still pending, as is a clean dependency-install build. No additional AWS resources were created.

The timed, word-for-word script is `docs/RECORDING_SCRIPT.md`; the complete editable submission narrative is `docs/DEVPOST_SUBMISSION.md`. These materials disclose the current fixture deployment and provide conditional narration for use only after live verification. Public repository/video links and final submission remain user-facing delivery steps.

See `docs/ACOUSTIC_AND_MOBILE.md` for the new waveform preset, mobile evidence flow, private scanner and verification boundaries.


## September 10 packaging correction

The review found that an earlier APK embedded port 3000 despite a port-3030 checkout setting, and source copied into the running web container did not match its image. The preview profile now supplies the public API URL explicitly; the local build checks the signed artifact, embedded URL and current branding before replacing the previous APK. The Docker recipe now includes the enterprise fixtures and documentation, and must be rebuilt from reviewed source before recreation.

The restored HACKATHON and GEMINI runbooks preserve setup commands and point here for current verification. The architecture shows mobile photos uploading directly to the API, current fixture/live-provider boundaries and waveform frequency measurement without fault-diagnosis claims. The original nine operations UI tests use mocked APIs; they are separate from real database/container integration checks.

Current evidence and any remaining packaging blockers are recorded in `docs/verification/2026-09-10-packaging.json`. Earlier image IDs above are historical snapshots. Physical-phone camera testing, successful live specialist reasoning, and actual operation of optional AWS adapters remain separate release gates.
