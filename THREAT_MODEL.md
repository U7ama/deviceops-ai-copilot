# Threat model

## Assets

Tenant membership and device context, manual versions and citations, run/approval/incident state, credentials/session tokens, media, audit integrity, and provider usage/cost records.

## Trust boundaries

1. Browser/mobile client → authenticated API.
2. API → PostgreSQL/RLS and pg-boss.
3. Worker → model provider, retrieval corpus, simulated telemetry, and media processor.
4. Core → n8n webhook and acknowledgement.
5. Public/allowlisted manual sources → ingestion parser.

## Main threats and controls

- BOLA/cross-tenant access: server session resolution, tenant predicates, forced RLS, tenant-isolation tests.
- CSRF/session theft: strict cookies, Origin checks, CSRF token, short-lived mobile access, refresh rotation and revocation.
- Prompt injection/data exfiltration: retrieved text is quoted untrusted data; injection signals are excluded; model cannot choose tenant or authorization.
- Tool/approval abuse: read-only automatic tools, bounded budgets, server-derived risk, proposal hash, separation of duties, CAS state transition, audit/outbox.
- Replay/duplicate side effects: idempotency keys, command key, webhook timestamp/nonce/delivery uniqueness, at-least-once retry records.
- SSRF/supply-chain parsing: HTTPS allow-list, every-redirect DNS validation, private-IP blocking, byte/MIME/timeout limits and isolated parser.
- Malware/media abuse: quarantine, checksum/magic/type limits, fail-closed scanner, no raw media logs, retention/tombstone.
- Secret leakage: redaction, no committed environment files, no default integration secret, private n8n/clamd network.
- Availability/cost: per-run model/tool/time/cost budgets, queue expiry, bounded retries, metrics, rate limits, and readiness checks.

Production deployment requires compliance validation, device authorization, multi-region recovery testing, and provider availability verification.
