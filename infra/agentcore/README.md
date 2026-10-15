# DeviceOps Strands on AgentCore (direct ZIP)

The deployed candidate uses the existing Strands agent, specialist orchestration,
critic, budgets, invocation cancellation checks and scoped MCP implementation.
It does not use the simplified `agent_server.py` replacement.

Runtime: `deviceops_strands_agent-sYACvw86Ik` in `us-east-1`.
Model: explicitly selected `qwen3.7-max`.
S3 key: `agent/deviceops-strands-96e8fc6f5fbca5f9.zip`.
ZIP SHA-256: `96e8fc6f5fbca5f997ebb7b98d052edcbaf61cb1dcf7546390c322b2399966b9`.
Compressed size: 79,458,419 bytes. Dependencies reused from the existing ARM64 image.

`zip_main.py` loads bundled Python dependencies and sets an absolute path to the
bundled ARM64 Node executable. `mcp-entry.ts` bundles the existing operations MCP
server without importing legacy database adapters. `package_zip.py` packages a
staging directory with those dependencies and enforces ZIP size limits.

## Local connection

Add `compose.agentcore.yaml` after the existing local demonstration, enterprise, Qwen and
Qwen development overlays. Recreate web, worker and strands with `--no-build
--pull never --no-deps`; do not rebuild images. `.env.demo` stores the runtime
ARN and matching Qwen model. The bridge alone receives read-only AWS credentials.
The Qwen child process strips AWS credentials from its environment.

`tool_proxy.py` binds 127.0.0.1:3035. Only POST `/api/v2/internal/tools` and
`/api/v2/internal/invocation-status` are forwarded to port 3030. The backend
validates each scoped grant. Other routes return 404; missing bearer tokens return
401. Both restrictions were verified through the public tunnel.

Cloudflared on Windows forwards to localhost:3035. Keep the computer, backend,
proxy and tunnel running. Quick-tunnel URLs change on restart; update the runtime
origin before another demonstration. This is a demo connection, not unattended hosting.

## Rollback and verification

The old `deviceops_specialist_agent-P0nHnPA6cG` runtime remains untouched. Its ZIP
is a simplified direct-model implementation and must not be described as Strands.
For local Strands rollback, recreate the same services without the AgentCore
overlay. Keep model configuration aligned across web, worker and strands.

The new runtime is READY; an empty cloud invocation returned the expected 422
validation failure without model usage. ARM64 Python/Strands imports and bundled
Node MCP startup passed offline. Two existing AWS-adapter tests and one focused bridge request-contract test passed.
Live recovery evidence is recorded separately after the one authorized rehearsal.

The old runtime could not be updated due to an applied Versions per Agent quota
of zero. Increase request `1698b0e1d406483781a8ecba773ed01fKtA6cgrU` is pending;
AWS required requesting 1001, above its default 1000. The candidate uses the
already-approved total-runtime allowance. No container quota change was needed.

## Historical rehearsal outcome (2026-09-13)

The initial cloud rehearsal reached real MCP reads, specialist calls, and critic completion, but encountered a return-path timeout in the stdio subprocess bridge (`docs/verification/agentcore-strands-recovery.json`), causing incident `45afd1ce-c5c7-40b7-a223-db289e73e198` to escalate safely with zero commands executed.

## Hardened candidate verification (2026-09-14 — PASSED)

The return-path issue was resolved by implementing the Option B in-process bounded MCP client (`BoundedMCPClient` in `apps/strands-agent/bounded_mcp.py`), eliminating the unbuffered subprocess pipe deadlock.

Deployed as hardened candidate runtime:
- **Runtime ARN**: `arn:aws:bedrock-agentcore:us-east-1:705384652382:runtime/deviceops_strands_bounded-22yEC79ykp`
- **Autonomous Recovery (PASSED)**: Verified automatic remediation of simulator service hang in **100.5 seconds** (`docs/verification/agentcore-bounded-recovery.json`).
- **Human Manager Approval Recovery (PASSED)**: Verified complete human approval lifecycle on a shared distribution switch in **114.3 seconds** (`docs/verification/agentcore-switch-approval.json`): multi-specialist investigation, proposal requiring manager approval, zero pre-approval commands verified, authenticated manager API decision, simulator restart, and 3 consecutive healthy observation cycles before resolution.
- See full hardening audit log in [`docs/verification/AGENTCORE_HARDENING.md`](../../docs/verification/AGENTCORE_HARDENING.md).
