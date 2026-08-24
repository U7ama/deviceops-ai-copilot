# Deployment Runbook

This guide covers operational procedures for deploying, maintaining, and recovering the DeviceOps system.

## 1. Local Development Setup

To stand up the application locally using Docker Desktop and Node.js 22.16:

1. **Environment**: Copy the template.
   ```bash
   cp .env.example .env
   ```
2. **Infrastructure**: Start PostgreSQL, n8n, Mailpit, and Jaeger.
   ```bash
   docker compose up -d postgres n8n mailpit jaeger
   ```
3. **Database Preparation**: Install dependencies, migrate, and seed.
   ```bash
   npm install
   npm run db:migrate
   SEED_PASSWORD='your-secure-password' npm run db:seed
   ```
4. **Development Server**: Run Next.js and the pg-boss worker.
   ```bash
   npm run dev
   ```

## 2. Production Deployment Considerations

When moving from local development to production, adjust the following:

- **Environment Variables**: Use strong random secrets for `SESSION_SECRET` and `N8N_WEBHOOK_SECRET`. Configure `DATABASE_URL` and `DATABASE_ADMIN_URL` correctly.
- **AI Provider**: Switch `AI_PROVIDER` from `mock` to `openai` (or compatible). Provide `OPENAI_API_KEY`.
- **Media Storage**: Switch `MEDIA_PROVIDER` from `local` to `s3`. Local ext4 fixture scanning is for development only. Production requires a real ClamAV instance or managed malware scanning.
- **Email**: Replace local Mailpit (`MAILPIT_API_URL`) with a real SMTP/API provider (e.g., SendGrid, SES) in the n8n environment.
- **Database**: Use a managed PostgreSQL 17 instance with pgvector 0.8.1+. Ensure RLS is strictly enabled.

## 3. Backup and Restore

PostgreSQL backups must be encrypted and stored in independent, resilient storage.

**Backup**:
```bash
scripts/backup.sh > backup.sql
```

**Restore (Test Drill)**:
```bash
scripts/restore.sh backup.sql deviceops_restore
```
*Note: Always restore to a secondary/disposable database to verify integrity (RPO/RTO validation) before touching production data.*

## 4. Migration and Rollback

Migrations are managed via Prisma/Kysely checked into `packages/db`.

- **Migrate Forward**: `npm run db:migrate`
- **Rollback**: Production downgrades usually require restoring from the pre-deployment backup, as down-migrations in append-only architectures (like outboxes/audit trails) risk data integrity. Always verify zero-downtime schema changes before deploying.

## 5. Monitoring and Alerting

- **Health Checks**: Monitor `/healthz` and `/readyz` for load balancer routing.
- **Metrics**: Scrape `/metrics` via Prometheus. Watch for:
  - High dead-letter queue depth (`pg-boss` failures).
  - Outbox processing latency.
  - Model latency and API limits.
  - 5xx error rates on `/api/v1/*`.
- **Tracing**: Analyze OpenTelemetry traces via Jaeger (port 16686 locally) for run execution bottlenecks.

## 6. Secret Rotation

1. **Session Secret**: Deploy the new secret alongside the old one if the library supports rotation arrays. Otherwise, a hard rotation will force all users to log in again.
2. **N8N Webhook Secret**: Update both the Next.js environment (`N8N_WEBHOOK_SECRET`) and the n8n container environment concurrently. Pause the worker/outbox during the rotation to prevent failed HMAC validations.
3. **Database Credentials**: Use Vault or AWS Secrets Manager. Rotate the `app` role independently from the `admin` role.

## 7. Common Troubleshooting

- **Symptom: Runs stuck in `queued` state.**
  - *Cause*: The `apps/worker` process is down or database connection is exhausted.
  - *Fix*: Check worker logs. Verify PostgreSQL connection limits.
- **Symptom: Incidents not arriving in n8n.**
  - *Cause*: HMAC mismatch, n8n webhook offline, or outbox failing to process.
  - *Fix*: Check `incident.approved` outbox events. Verify `N8N_WEBHOOK_SECRET` parity.
- **Symptom: File uploads permanently quarantined.**
  - *Cause*: ClamAV scanner unavailable or `MEDIA_SCANNER` misconfigured.
  - *Fix*: Ensure ClamAV service is healthy and reachable. Check `apps/web` logs for `scanner_error`.
