# DeviceOps project overview

DeviceOps connects equipment observations, dependency-aware investigation, reviewed recovery proposals and verified outcomes. It is designed around an operations engineer moving from an alert to an evidence-backed decision.

## Operator workflow

1. Review incidents and affected equipment in the Operations dashboard.
2. Inspect the observations, dependency impact and specialist findings behind a diagnosis.
3. Attach photos, PDF pages or telemetry where additional evidence is needed.
4. Review consequential proposals, including the target, exact arguments and safety checks.
5. Authorize only the reviewed proposal. The backend enforces role, hash, freshness and idempotency checks.
6. Follow execution and recovery observations. Resolution requires three fresh healthy samples across the affected devices.
7. Review the report and deliberately publish reusable runbook knowledge.

The v1 diagnosis interface remains available for manual investigation alongside the v2 incident workflow.

## Engineering decisions

- **Reasoning and authority are separate.** Strands specialists and the Critic produce evidence-backed findings; deterministic backend policy controls execution.
- **Scope follows identity.** Sessions, tenant boundaries, invocation grants and read-only MCP tools constrain evidence access.
- **Evidence retains provenance.** Observations, citations, timestamps, upload checksums and analysis outputs stay tied to the incident.
- **Recovery is independently observed.** A successful command response cannot substitute for healthy post-action telemetry.
- **Provider selection is explicit.** Qwen and Bedrock paths are configured separately. Fixture mode supports repeatable local checks without paid calls.
- **Notifications do not authorize actions.** Signed n8n delivery and acknowledgment remain separate from command and recovery state.

Next.js and a TypeScript worker share PostgreSQL-backed operational state and durable jobs. The Python Strands service can run locally or through AgentCore. The recorded hybrid path keeps the database, simulators and analysis broker local while scoped callbacks supply evidence to cloud reasoning. See [architecture](ARCHITECTURE.md).

## Recorded results

The repository includes historical records of AgentCore/Qwen simulator recovery:

| Workflow | Recorded duration | Evidence |
| --- | --- | --- |
| Backend-authorized simulator service restart and verified recovery | 100.5 seconds | [Service recovery](verification/agentcore-bounded-recovery.json) |
| Manager-reviewed simulator switch restart and verified recovery | 114.3 seconds | [Approval and recovery](verification/agentcore-switch-approval.json) |

These are measured demonstration runs, not latency guarantees or proof of a currently available deployment. Local Strands/Qwen checks are recorded separately in [Qwen recovery](verification/qwen-recovery.json). [AgentCore limitations](verification/AGENTCORE_HARDENING.md) document cancellation and repeated-request cleanup boundaries.

The UI has fixture-backed coverage for navigation, themes, responsive layouts, v1/v2 request payloads, authentication presentation and approval restrictions. See [UI verification](UI_MIGRATION.md). Those fixtures do not replace backend-connected tests.

## Current boundaries

Real equipment remains read-only, and remediation is restricted to simulators. Adapter fixture coverage does not establish physical vendor compatibility. CSV charts and waveform spectra are analysis outputs, not validated hardware-fault predictions. Broader fleet scale, high availability and regulated use require further validation.

## Explore the project

- [Local setup and features](../README.md)
- [Operations runbook](OPERATIONS_RUNBOOK.md)
- [Mobile and evidence setup](ACOUSTIC_AND_MOBILE.md)
- [Integration catalog](INTEGRATIONS.md)
- [Security controls](../SECURITY.md)

Frameworks, SDKs and adapted UI components retain their respective third-party notices.
