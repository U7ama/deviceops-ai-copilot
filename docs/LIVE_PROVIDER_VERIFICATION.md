# Live provider verification — September 8, 2026

## Readiness conclusion

The agent has demonstrated real Strands → Gemini → scoped MCP investigation and approved simulator recovery. It is not yet production-ready: the failed-recovery live scenario needs successful retesting, Gemini free-tier quota was exhausted/rate-limited, Bedrock/Titan remains account-blocked, and hosted operation and real hardware remain unverified.

## Provider probes

| Path | Observed result |
| --- | --- |
| Bedrock Nova Lite, us-east-1 | Actual inference rejected: ValidationException, Operation not allowed |
| Bedrock Nova Lite, us-east-2 | Same rejection |
| Titan Embeddings v2, us-east-1 | Actual embedding request rejected: Operation not allowed |
| Titan Embeddings v2, us-east-2 | Same rejection |
| Gemini 2.5 Flash | Metadata listed it, but actual inference returned HTTP 404 |
| Gemini 3.7 Flash | Actual inference succeeded, with reported input, visible output and thinking-token usage |
| Strands + Gemini + lexical runbooks | Live investigation succeeded |
| Strands + Bedrock + Titan | Blocked by the actual AWS invocation failures |
| Strands + Gemini + Titan | Not verified: Titan invocation is blocked; the current Gemini mode intentionally uses lexical retrieval and disables its embedding route |

Gemini is an external Strands provider, not a model hosted through Bedrock in this implementation. No provider fallback, other-account workaround or AWS infrastructure deployment was performed.

## Live scenarios on isolated PostgreSQL 17

| Scenario | Result |
| --- | --- |
| Switch outage | Passed: topology-backed diagnosis; 7 MCP tools, 4 model calls; manager approval; one simulator command; sustained recovery; resolved in about 47 seconds |
| Service hang | Passed on diagnostic retest: 5 model calls, 7 MCP calls, one policy-authorized service restart, fresh recovery checks and resolution in 76 seconds |
| Authentication failure | Passed: identified authentication failure while reachable; no restart; escalated for credential review |
| Conflicting telemetry | Passed: distinguished fresh local health from delayed cloud error reports; no disruptive action; escalated with uncertainty |
| Failed recovery | Incomplete: provider failure prevented the diagnosis, so this did not test the intended post-command recovery timeout live |

Four investigations returned validated Gemini diagnoses. Later attempts failed; the diagnostic attempt established HTTP 429 provider rate limiting. The earlier generic failures cannot retrospectively be proven to have the same cause.

The initial service-hang failure was traced to stale cited observations. The prompt now requests a final target-health refresh after runbook/capability lookups and citation of its newest observation. The existing freshness policy remains intact. A successful live retest of that prompt change is still required; quota prevented completion. Correctly refusing a stale action is safe behavior, but does not satisfy the desired automatic-recovery demonstration.

## Updated-key retest

The user reported replacing the Gemini key. A tiny, no-retry `gemini-3.7-flash` generation with the saved key succeeded. The full service-hang investigation in a fresh isolated database nevertheless returned `provider_unavailable` after 39 seconds, with no validated diagnosis and zero commands. The existing sanitized logs do not identify the underlying exception; this is not proof of an invalid key or exhausted quota. The failed-recovery scenario was skipped automatically to avoid further consumption.

This retest had a separate $0.50 application limit and retained $0.24 for its uncertain failed invocation. Combined with the earlier ledger, conservative reservations/estimates total $1.090912, excluding tiny direct probes; this is not a billing statement. Test services were stopped afterward. Evidence: `/tmp/deviceops-retest-results.log`. The immediate blocker is diagnosing the full investigation failure despite successful basic API connectivity.

## Diagnostic follow-up

Safe diagnostics now record exception type, integer status and the last eight stack locations, excluding messages, source lines, locals and full paths. Strands `EventLoopException` wrappers are unwrapped before classification. Tests verify direct and wrapped provider errors retain their category without exposing sensitive messages: 45 Python tests passed.

The service-hang retest passed (27,126 input tokens, 624 output tokens, estimated $0.045369). A subsequent failed-recovery attempt revealed `EventLoopException` inside the SDK event loop, not the post-result capability check. After wrapper classification was fixed, one final attempt exposed `ModelThrottledException` and returned HTTP 429 `provider_rate_limited`. No command ran for either failed-recovery attempt. Testing stopped on the confirmed throttling; no automated retry was added. Earlier generic failures remain causally unproven.

The isolated retest ledger retains $0.765369 after its ceiling was raised incrementally to $1 without resetting balances. Together with the earlier $0.850912 ledger, conservative estimates/reservations total $1.616281, excluding tiny connectivity probes. This is not actual billed usage. All isolated services were stopped; the main Docker demo was preserved. Evidence: `/tmp/deviceops-diag-result.log`, `/tmp/deviceops-diag-unwrapped.log`, `/tmp/deviceops-diag-strands.log`, `/tmp/deviceops-diagnostics-tests.log`.

## Latest user-requested retry

After the user demonstrated a successful direct prompt, one additional failed-recovery investigation was attempted. It stopped after 53.4 seconds with confirmed `ModelThrottledException` / HTTP 429, no diagnosis and zero commands. The intended post-command failed-recovery outcome remains unverified live. No further requests were made after throttling. Isolated services were stopped and the primary Docker demo was preserved.

The isolated ledger now retains $1.005369 against a $1.25 ceiling; combined with the original $0.850912 ledger this is $1.856281 in conservative estimates and uncertain-call reservations, not actual billed charges. Evidence: `/tmp/deviceops-finalretry-result.log` and `/tmp/deviceops-finalretry-strands.log`.

## Cost and controls

Tests used an isolated database with a $2 application budget. Four completed investigations recorded 73,614 input tokens, 2,732 output tokens (including thinking as reported), and 16 model calls. Their conservative estimated cost was $0.130912. Three failed/uncertain attempts retained $0.72, yielding $0.850912 in the durable ledger. These estimates are not actual Google charges and exclude the tiny direct connectivity probes. The user supplied a free-tier key.

Gemini 3.7 defaults to low thinking and conservative $1.50/$7.50 per-million input/output rates, covering the published post-introductory prices. Current introductory pricing is lower. Maximum 120k input plus 8k output reserves $0.24 per investigation. Model/tool limits, subprocess cancellation, strict grant scope, and backend action policy remain enforced.

AWS credit balance was reported by the user as $140. The previously agreed $50 AWS spending ceiling was preserved. No additional resources were provisioned in AWS. Four tiny failed AWS inference/embedding probes were made; billing itself was not independently audited.

Pricing reference: https://ai.google.dev/gemini-api/docs/pricing . No attempts were made to evade free-tier rate limits. Live test services were stopped after testing; the primary Docker demo was preserved.

## Regression evidence

- All 14 operations API checks passed against the isolated PostgreSQL 17 database in fixture mode, including RLS, approval role/hash/replay checks, single execution and recovery.
- Standalone simulator → vault → collector → API → worker → command → recovery passed.
- Actual MCP stdio grant isolation, twelve-call cap and expired invocation recovery passed.
- Notification state-machine tests passed: HTTP acceptance is not delivery, concurrent claims authorize one sender, signed acknowledgements are idempotent, and unknown outcomes are not blindly resent.
- Actual Docker n8n → Mailpit → signed acknowledgement passed with exactly one matching message.
- All 10 browser tests passed, including Gemini provenance and an authenticated backend read. Nine are explicit UI fixtures; these are not ten live-model scenarios.
- 86 TypeScript tests passed; workspace typecheck and the final production build passed.
- 38 Python tests passed, including sanitized provider error categories; two dependency deprecation warnings remain.

Session logs: `/tmp/deviceops-final-api.log`, `deviceops-final-edge.log`, `deviceops-final-grants.log`, `deviceops-final-notifications.log`, `deviceops-final-notifications-live.log`, `deviceops-final-browser.log`, and `deviceops-final-python.log`. These files are local evidence, not bundled submission artifacts. Private seed logs and credentials must not be published.

## Remaining release gates

1. Once inference quota is available, verify failed-recovery timeout after one approved command. Service-hang recovery now passes. Do not automatically retry on 429.
2. Establish sustainable inference quota and usage monitoring for judge access; a free-tier smoke test does not establish availability under concurrent users.
3. Resolve Bedrock account eligibility if demonstrating Nova or Titan. Their live paths remain blocked. Gemini plus lexical retrieval can be demonstrated independently.
4. Rebuild the Docker images from final source, then repeat release checks against those exact images. The isolated live tests used current host source with PostgreSQL 17 in Docker.
5. Validate hosted deployment, authentication/session handling, backup/restore and operational monitoring before any production claim. No real hardware/vendor service compatibility is established by simulator tests.
6. Complete the architecture export, public source review, final video and submission with accurate provider labels and limitations.
