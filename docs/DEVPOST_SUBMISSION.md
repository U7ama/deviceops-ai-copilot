# DeviceOps — Autonomous Multi-Agent Operations & Incident Resolution for Enterprise Infrastructure

Draft submission copy. Intended track: Professional Agents, subject to the submission form's current categories. Finalize the repository URL, video URL and personal submission details in Devpost. Do not paste credentials or billing information into the submission.

## Elevator pitch

Autonomous multi-specialist agents that investigate campus infrastructure incidents, detect silent hardware drift, and execute policy-governed, verified recovery using AWS Strands.

## Inspiration

Campus and facilities teams often investigate failures across switches, room displays, cameras and services. A device that appears offline may be affected by an upstream failure. Restarting shared infrastructure without understanding its dependencies can make the incident worse. We wanted to connect investigation, evidence, authorization and recovery verification in one workflow.

## What it does

DeviceOps detects sustained telemetry drift, groups related incidents using stored topology and supports a bounded specialist investigation workflow. Network, system/service and power/hardware specialists share evidence; a critic reviews uncertainty and impact before the backend evaluates any proposed action.

Technicians can capture or choose incident photos in the existing mobile app and attach approved images, floorplans, PDFs and telemetry files. Relevant PDF pages are extracted and rendered with source citations. Approved CSV data can be analyzed inside a restricted disposable container, producing statistics and charts, including a bounded comparison of acoustic waveform spectra. Incident history, reviewed runbooks and metric baselines provide tenant-scoped context.

The backend owns execution policy. Critical or unknown dependency impact requires escalation. Eligible simulator actions use exact approval hashes, idempotent dispatch, fresh-evidence checks and independent recovery verification. Real equipment remains read-only.

## How we built it

The application uses a TypeScript web/backend and worker, PostgreSQL, the existing queue infrastructure and MCP tools. Python Strands orchestrates provider-configured investigations. Gemini and Bedrock are explicit reasoning options; AWS adapters are enabled only when independently verified. Evidence parsing and generated analysis run in restricted containers behind a private broker. Local storage is the verified evidence path; optional AWS integrations retain separate verification status.

## Challenges

Provider access has been the main live-integration constraint. The currently configured Gemini key returns HTTP 401. Earlier AWS checks found blocked Nova authorization and zero AgentCore Runtime quota. We retained a clearly labeled deterministic fixture mode, tested the installed Strands workflow with deterministic provider streams, and verified actual local evidence processing, sandbox execution and simulator recovery independently.

Document handling presented a second challenge: a relevant passage may be far beyond the cover page. We added bounded relevance-based extraction and selected-page rendering so a diagram on page thirty can be supplied with its correct citation.

## Accomplishments

- Preserved the existing operational scenarios while adding deterministic dependency-impact enforcement.
- Demonstrated optical receiver drift without claiming a validated failure forecast.
- Verified actual isolated statistics/chart generation and protected photo/PDF processing.
- Added selected-page image citations and a synthetic long-manual verification fixture.
- Made simulated, live, unavailable and unverified behavior explicit.

Use the latest verification report for final test counts; passing tests are evidence of the tested scope, not production certification.

## What we learned

Agent reasoning and execution authority need separate boundaries. A convincing diagnosis is insufficient without current evidence, scoped tools, explicit permissions and a verifiable recovery outcome. Provider-independent local verification also makes failures easier to distinguish from deployment or model-access problems.

## What's next

Complete a successful live specialist rehearsal after provider authentication is restored, independently verify optional AWS adapters, and improve device-specific retrieval and field evidence capture. Fleet scale testing, seasonal learning, high availability and clinical deployment are outside this hackathon release.

## Disclosure for the final submission

The current demonstrated deployment uses fixture investigations. Synthetic telemetry, original MIT fixtures and simulated remediation are labeled. Selected PDF rendering and sandbox execution are actual local operations. Do not describe AWS adapters or the new live specialist workflow as verified until the corresponding live gates pass. Update this paragraph and the recording narration only after obtaining that evidence.
