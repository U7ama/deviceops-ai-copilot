# Security controls

## Identity and tenant scope

Web sessions are opaque, database-backed, Secure/HttpOnly/SameSite cookies with Origin and double-submit CSRF checks. Mobile sessions use short-lived access tokens and rotated refresh tokens stored in Expo SecureStore. Local seeded passwords use Argon2id; login failures have a bounded lockout.

Every protected row carries `tenant_id`. PostgreSQL RLS is enabled and forced for the application role; each transaction sets `app.tenant_id` and `app.user_id`. Deterministic application policy remains mandatory because a database policy is not a complete authorization model.

## AI and tool safety

The model is not a security boundary. Server code derives risk and approval from a typed allow-list, binds tools to the authenticated room/device, validates citations against retrieved rows, caps turns/tools/tokens/time/cost, and never streams hidden reasoning. Retrieved manuals, images, transcripts, and model arguments are untrusted data.

## Data and integration safety

Manual ingestion is versioned and publication is atomic after embeddings. Public fetches must use an HTTPS allow-list with redirect revalidation, DNS/private-IP blocking, MIME/size/time limits, and isolated parsing. n8n envelopes require HMAC, timestamp, nonce, delivery id, and idempotent acknowledgement; n8n has no authorization authority.

Media is UUID-keyed and quarantined. Checksums, magic bytes, type/size/dimension/duration limits, scanner verdict, retention, and deletion are recorded. Production requires a private scanner service and S3 quarantine/clean prefixes.

## Reporting boundary

Do not put credentials, real device identifiers, client material, uploaded media, raw prompts, or provider secrets in this repository. Report only reproducible evidence and label mock-provider, adapter-included, and externally verified results separately.
