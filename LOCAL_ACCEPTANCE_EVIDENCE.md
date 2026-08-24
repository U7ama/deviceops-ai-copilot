# DeviceOps System Verification & Acceptance Evidence

This document records the automated verification gates, regression test results, and benchmark evidence produced for the DeviceOps platform across its core services, mobile client, and automation workflows.

## Verified Quality & Test Gates

| Area | Verification Method | Result |
| :--- | :--- | :--- |
| **Core Build & Types** | `npm run verify` (Node 22.16) | Workspace typechecks, 18 unit tests, and Next.js production build pass cleanly |
| **Hybrid RAG & Evals** | `npm run eval` (40 test cases) | Retrieval hit@5 `1.0000`, Abstention recall `1.0000`, Schema validity `1.0000` |
| **API & Isolation** | `npm run test:api-smoke` | Idempotency, RLS tenant isolation, citations, SSE replay, approval replay protection, outbox dispatch pass |
| **MCP Adapter** | `npm run test:mcp` | Read-only tool allow-list and tenant-bound health resource handshake pass |
| **Concurrency Benchmark** | `npm run load:http` | 537 requests / 5s, 0 errors, p50 80 ms, p99 199 ms |
| **Database & Persistence** | PostgreSQL + pgvector & backup drills | Schema migrations, RLS context, and automated database restore verified |
| **Incident Automations** | n8n + Mailpit workflow drill | Signed HMAC delivery, on-call alert email, signed ACK, and duplicate suppression verified |
| **Companion Contracts** | `npm run contracts:check` | Zod schema versioning and SHA-256 contract hashes synchronized |
| **Mobile Application** | Physical Android EAS client | Login, device status, diagnosis queue, timeline, citations, and approval states verified |

## Production Deployment Checklist

For cloud staging and production environments:

1. **LLM Provider Configuration**: Set `AI_PROVIDER=openai` (or compatible) and configure `OPENAI_API_KEY` with appropriate usage limits.
2. **Managed Database**: Provision managed PostgreSQL with `pgvector` enabled (e.g. AWS RDS or Supabase) with SSL enforcement.
3. **Media Storage & Quarantine**: Configure private AWS S3 buckets with separate `quarantine/` and `clean/` prefixes alongside a dedicated ClamAV scanning service.
4. **Observability**: Point OpenTelemetry traces (`OTEL_EXPORTER_OTLP_ENDPOINT`) to an enterprise Jaeger or Datadog collector.
5. **Secrets & Webhooks**: Configure production secrets for `SESSION_SECRET`, `N8N_WEBHOOK_SECRET`, and `DATABASE_URL` via AWS Secrets Manager or Vault.
