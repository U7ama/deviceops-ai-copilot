# DeviceOps local acceptance evidence

This document records what is actually verified on the current workstation. It is intentionally separate from the production-grade design contract so that a passing local check cannot be mistaken for hosted SaaS evidence.

## Verified offline or local

| Area | Evidence | Result |
| --- | --- | --- |
| Core build | `npm run verify` under Node 22.16 | Typecheck, 18 tests, and production build pass |
| RAG/evals | `npm run eval` | 40 evaluation cases; hit@5 1.0000, abstention recall 1.0000, schema 1.0000 |
| API controls | `npm run test:api-smoke` | Idempotency, RLS isolation, citations, SSE replay, approval separation/replay, outbox, signed webhook, media rejection pass |
| MCP | `npm run test:mcp` | Read-only tools and tenant-bound health resource pass |
| HTTP | `npm run load:http` | 537 requests / 5s, 0 errors, p50 80 ms, p99 199 ms in the recorded WSL run |
| Database | Compose PostgreSQL + pgvector, migrations, seed, backup/restore drill | Local schema and disposable restore verified |
| Automations | n8n + Mailpit Compose drill | Signed delivery, email, acknowledgement, and duplicate suppression verified |
| Mobile contracts | `deviceops-mobile/npm run verify` | Typecheck and contract hash pass |
| Android app | EAS development APK installed on attached physical device | Login, device list, diagnosis queue, timeline, citation, and approval-required state manually observed |

## Not yet claimable

- No OpenAI/Gemini key is configured, so provider quality, token cost, and real-provider latency are not measured.
- No AWS/S3 or managed Postgres deployment is configured; local Docker is not a high-availability deployment.
- The default media scanner is fixture-only. Production requires private object storage and a real fail-closed scanner.
- The Maestro YAML is committed, but the Maestro CLI has not been run in this environment.
- No Playwright browser test suite or public hosted demo has been executed.
- Push notification and store release are pending cloud configuration.
- `npm audit --omit=dev` currently reports three high advisories in the installed dependency tree (`@playwright/test`, `playwright`, and `sharp`); review and update these before any public deployment.

Do not move these items to a resume's delivered-skills list until the corresponding evidence exists.
