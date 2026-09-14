# AgentCore hardening

## Current implementation and verification scope

The cloud endpoint runs `investigate` through `asyncio.to_thread`, with an
`asyncio.Lock` for normal request admission. It does not use the process-isolated
runner. Validation and provider failures return fixed error categories rather
than raw exceptions or request values.

`BoundedMCPClient.stop()` requests shutdown and waits up to two seconds for the
MCP background thread. It then clears its references, even if the thread remains
alive. This bounds the join wait; it does not prove cleanup completed or provide
fail-closed shutdown. The application subclass leaves the installed SDK file
unmodified. Node stdin end/close handlers remain in the cloud MCP entrypoint.

The separate process-isolated runner remains available for the local execution
path. Its process-reaping tests do not establish cleanup behavior in the cloud
endpoint. Earlier process-isolation and five-second fail-closed cleanup notes
are superseded by this implementation. The earlier tunnel blockage is historical;
the recorded rehearsal below used the user-started tunnel successfully.

## Known limitations and remaining verification

- A daemon thread can remain active while the server process lives. A two-second
  join and cleared references do not establish that the thread or its MCP child
  stopped. The current mock cleanup test checks the join argument and reference
  reset, not real resource cleanup.
- If the request coroutine is cancelled, the admission lock can be released
  while its investigation thread continues. Client disconnection does not
  necessarily cancel that coroutine. Cancellation and overlapping-request
  behavior have not been demonstrated safe by the recorded rehearsal.
- The 100.5-second rehearsal demonstrates automatic simulator service recovery,
  and the subsequent 114.3-second rehearsal verifies authenticated manager approval
  and switch recovery (`docs/verification/agentcore-switch-approval.json`).
  Cancellation handling and repeated-request cleanup remain documented limitations.
  Preserve backend authorization and simulator-only action restrictions.
- The cause of the earlier runtime startup failures was not isolated. Changing
  multiple implementation details between deployments does not prove subprocess
  execution was the cause.

Preserve the passing deployment for recording. Future lifecycle work should
retain ownership of unfinished work and verify cleanup and cancellation with
focused tests before deployment. Do not forcefully terminate Python threads.

The following is recorded deployment evidence, not a fresh AWS availability
check. This documentation correction makes no runtime or deployment changes.

## 2026-09-14 Option B Autonomous Recovery (PASSED)

- **Architecture:** Clean Option B implementation in application code (`BoundedMCPClient` in `apps/strands-agent/bounded_mcp.py` and `asyncio.to_thread` with error sanitization in `apps/strands-agent/agentcore_app.py`).
- **Dependencies:** 100% official unmodified Strands SDK (`mcp_client.py` SHA-256: `0ea0ff985d5362cc79c602c0d70bc1935ae5c43c606e69775f9e66c1720f12b3`). No monkey-patching of `site-packages` or `.venv`.
- **Runtime:** `arn:aws:bedrock-agentcore:us-east-1:705384652382:runtime/deviceops_strands_bounded-22yEC79ykp`.
- **ZIP Package:** `agent/deviceops-strands-363b3dd439557101.zip` (SHA-256: `363b3dd439557101311aec9ccd79cb92e4675b9fb47d17067bf37ee622339735`, 79,460,037 bytes).
- **Runtime Preservation:** Verified fallback runtime `deviceops_strands_agent-MpLPjL7SQx` preserved and untouched in AWS.
- **Live Incident Recovery Rehearsal:**
  - Scenario: `service_hang` on simulator device `6dbe3967-567e-4aaa-8955-b5a01d566878`.
  - Multi-Agent Orchestration: Domain specialists + Critic consistency verification + Synthesis executed in AWS Bedrock AgentCore.
  - Evidence Collection: Retrieved topology, device health, and telemetry via MCP tools over Cloudflare tunnel (`https://trying-grab-england-gnu.trycloudflare.com`).
  - Action Dispatched: `restart_service` command executed and acknowledged.
  - Verification: 3 consecutive healthy telemetry samples observed.
  - Outcome: Incident resolved with `"passed": true`.
  - Total Duration: 100.5 seconds (well below timeouts).
  - Verification Artifact: `docs/verification/agentcore-bounded-recovery.json`.

## 2026-09-14 Option B Manager Approval Recovery (PASSED)

- **Runtime:** `arn:aws:bedrock-agentcore:us-east-1:705384652382:runtime/deviceops_strands_bounded-22yEC79ykp`.
- **Scenario:** `switch_failure` on root switch device `8a04af0f-762b-46ac-89c9-b03b9533fdb7`.
- **Multi-Agent Orchestration:** Network + Critic specialists in AWS Bedrock AgentCore diagnosed total switch outage, verified topology-connected downstream devices, cited runbook, and returned `restart_switch` proposal with `approval_required` risk.
- **Pre-Approval Invariant:** Invariant verified — exactly 0 commands existed or executed prior to manager decision.
- **Human Approval:** Authenticated manager approval decision submitted via API (`POST /api/v2/approvals/{id}/decision`) with exact cryptographic proposal hash matching.
- **Action Execution:** Simulator dispatched and acknowledged `restart_switch`.
- **Verification:** 3 consecutive healthy telemetry observation cycles confirmed across switch and all 4 downstream devices.
- **Outcome:** Incident resolved with `"passed": true`.
- **Total Duration:** 114.3 seconds.
- **Verification Artifact:** `docs/verification/agentcore-switch-approval.json`.

