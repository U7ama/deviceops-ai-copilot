# Architecture walkthrough

DeviceOps is a modular monolith plus one durable worker. The database is the source of truth; model output and n8n are untrusted adapters.

## One request, end to end

1. A web or mobile client authenticates. The server resolves the opaque session to one user, role, and tenant. Client-supplied tenant IDs are ignored.
2. `POST /api/v1/runs` validates the Zod request and `Idempotency-Key`, then in one RLS-scoped transaction inserts the queued run, user message, `run.accepted` event, audit record, and `run.requested` outbox row.
3. pg-boss receives the durable job. If the process dies after the database commit, outbox recovery republishes it; the singleton key prevents duplicate processing.
4. The worker claims `queued → running` with a server-side conditional update. It searches published chunks using tenant/role filters, PostgreSQL full text, deterministic/provider embeddings, and reciprocal-rank fusion.
5. The bounded provider can automatically call only `search_manual` and `get_device_status`. Tool arguments are rebound to the authenticated run context. Retrieved text is delimited untrusted data; injection-like chunks are excluded.
6. The provider result must pass the strict diagnosis schema. The server validates citation IDs, offsets, source versions, evidence sufficiency, risk, and approval. A bad result becomes a safe fallback, never an executable instruction.
7. The worker persists retrieval results, usage/cost, validated diagnosis, and durable events. The web SSE endpoint replays `run_events` from `Last-Event-ID`; it does not expose hidden chain-of-thought.
8. A consequential proposal creates `approval_requests`. A manager/admin must approve with the original proposal hash, cannot be the requester, and is checked again inside a compare-and-swap transaction.
9. Approval writes the incident and `incident.approved` outbox event atomically. n8n receives a signed envelope, routes the notification, and sends a signed acknowledgement. n8n never changes authorization or owns incident truth.

## Why the boundaries matter

- RLS is defense in depth; application authorization still runs before every protected operation.
- Outbox and idempotency make retries safe without pretending delivery is exactly once.
- SSE is a projection of durable events, so reconnects and mobile polling do not repeat work.
- The mock provider makes tests deterministic. The OpenAI adapter is opt-in and its model, schema, tokens, latency, and estimated cost are recorded.
- Media enters quarantine, is checksum-verified and scanned, and can be attached only after a clean verdict. Local fixture scanning is not malware protection.
