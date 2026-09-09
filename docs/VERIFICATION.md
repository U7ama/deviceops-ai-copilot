# DeviceOps verification — September 7, 2026

This record describes local simulator evidence. It does not certify vendor hardware, live Bedrock inference, or a public deployment.

## Complete and verified locally

| Check | Result | Evidence from this session |
| --- | --- | --- |
| TypeScript unit/contract tests | 82 passed, 12 files | `/tmp/deviceops-tests-final.log` |
| Workspace typecheck | Passed | `/tmp/deviceops-typecheck-final.log` |
| Next production build | Passed | `/tmp/deviceops-build-final.log` |
| Python service offline tests | 26 passed; two dependency deprecation warnings | `/tmp/deviceops-python-owner.log` |
| Python contract export | Passed | Schema export check |
| Browser operations checks | 9 passed: eight API fixtures and one authenticated live backend read | `/tmp/deviceops-browser-owner.log` |
| Operations API/worker/PostgreSQL 16 | 14 checks passed, including tenant RLS, approvals, single execution and sustained recovery | `/tmp/deviceops-integration-owner.log` |
| Standalone edge pipeline | Simulator → vault → collector → API → worker → one command → fresh recovery samples passed | `/tmp/deviceops-edge-owner.log` |
| Actual MCP stdio invocation grants | Scope enforcement, twelve-call budget and expired lease recovery passed | `/tmp/deviceops-grants-owner.log` |
| Notification state-machine integration | Acceptance versus delivery, concurrent claim, signed acknowledgement/replay and unknown-outcome handling passed | `scripts/ops-notifications-integration.mts` |
| Docker application image | Built successfully | `/tmp/deviceops-compose-build.log` |
| Docker PostgreSQL 17 | Healthy; all three migrations and disposable seed completed | Local Compose stack |
| Docker notification flow | Core → n8n → exactly one Mailpit message → signed core acknowledgement passed | `/tmp/deviceops-notifications-live.log` |
| Packaging static checks | Compose configurations, infrastructure JSON syntax and diff whitespace passed | Local checks |

Logs under `/tmp` are session-local and are not submission artifacts. Do not publish private seed logs, credentials or browser traces.

The MCP `tenantId` issue was an incorrect test expectation: the current reader rejects unknown arguments before backend access. The test now expects the rejected tool call; authorization was not relaxed.

## Artifact boundaries

The final production build includes the collector failure-gap adjustment and passed after the 82-test suite and typecheck. The earlier browser/integration drills preceded that small adjustment, which has a targeted regression. Rebuild the Docker release image from the final source before packaging it.

The running Docker app image also predates that final adjustment. The notification probe was copied into the running container; notification implementation was already present in the built image. Docker delivery verification therefore covers that notification path, not an assertion that the running image contains every current working-tree change.

The local n8n workflow is published. CLI import in n8n 2.0 did not create publishable history; saving an actual node edit through the editor API created a revision, then CLI publication and restart succeeded. Core request timeouts are 30 seconds to tolerate local development compilation. Recipients are trapped `.test` addresses in Mailpit. No external message was sent.

## Implemented but not verified against external services

- Strands/Bedrock investigation and Titan embedding paths, guarded by confirmed-credit configuration and durable reservations. Offline tests are not evidence of successful AWS calls.
- Hosted CloudFormation, production Compose overlay and reverse-proxy configuration. JSON/config checks are not AWS deployment validation.
- Connector catalog with 57 entries. Implemented adapters have local tests; the remaining catalog is a roadmap, not 57 working vendor integrations.

## Immediate external blocker and release work

The next blocker is funded AWS access: account/credits and permission to use the configured models have not been confirmed. No paid AWS call or cloud deployment was performed. Preserve the total $50 ceiling; the application model ledger does not cap infrastructure or other AWS spending.

Once funded access is available, run a real Strands investigation and Titan indexing/retrieval evaluation, verify reservations and actual usage, and record provider-labelled results. Before any hosted launch, estimate all services within the ceiling, rebuild the exact final source, validate/deploy the infrastructure and verify HTTPS, authentication, tenant isolation and judge access.

Public repository publication, organizer eligibility review, AWS Builder ID, final demo video and Devpost submission remain unfinished. Device remediation remains simulator-only. No real device or employer system was modified.

## September 8 — explicit Gemini provider

Added Gemini 2.5 Flash through the installed Strands SDK, preserving Bedrock and rejecting automatic fallback. Backend and Python provider checks, separate Google usage confirmation, shared durable cost accounting, lexical retrieval, UI provenance and a Gemini Compose overlay are implemented.

- 85 TypeScript tests passed (`/tmp/deviceops-gemini-tests.log`).
- 33 Python offline tests passed (`/tmp/deviceops-gemini-python.log`), including the real Strands loop driven by mocked Gemini streams.
- Workspace typecheck and the final Next production build passed (`/tmp/deviceops-gemini-types.log`, `/tmp/deviceops-gemini-build.log`).
- Gemini Compose configuration, credential routing, SDK request options, dependency consistency and exported schemas passed validation.
- No Gemini key was present in the checked project environment files. No live Gemini call was made and active services were not switched.
- The Docker images built before this change do not contain this provider implementation; rebuild using the commands in [GEMINI.md](GEMINI.md).

The earlier AWS-only release blocker can now be bypassed by selecting a usable Gemini account through Strands. Actual Google authorization, diagnosis quality, end-to-end recovery and costs still need live verification.

## Live-provider follow-up

See [LIVE_PROVIDER_VERIFICATION.md](LIVE_PROVIDER_VERIFICATION.md) for September 8 actual Gemini inference, successful switch/auth/conflict scenarios, the stale-evidence service-hang gap, subsequent rate limiting, and confirmed Bedrock/Titan invocation failures. This supersedes earlier statements that no live Gemini call had been made.
