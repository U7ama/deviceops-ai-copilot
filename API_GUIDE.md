# API & Event Contract Guide

This guide documents the core REST and SSE endpoints exposed by the Next.js backend under `/api/v1/`.

## 1. Authentication
Endpoints managing user identity and sessions.

- **`POST /api/v1/auth/login`**
  - **Purpose**: Authenticate a user and create a session.
  - **Auth**: None.
  - **Request**: `email`, `password`, `client` ("web" or "mobile").
  - **Response**: `SessionUser` object (ID, email, tenantId, role).
- **`POST /api/v1/auth/refresh`**
  - **Purpose**: Exchange a valid refresh token for a new short-lived access token (Mobile only).
  - **Auth**: Valid refresh token.
- **`POST /api/v1/auth/logout`**
  - **Purpose**: Terminate the current session.
  - **Auth**: Required.
- **`GET /api/v1/auth/me`**
  - **Purpose**: Retrieve the current authenticated user's profile.
  - **Auth**: Required.
- **`GET /api/v1/auth/csrf`**
  - **Purpose**: Obtain a CSRF token for web clients to include in subsequent state-mutating requests.
  - **Auth**: Required.

## 2. Runs
Diagnostic sessions tracking retrieval and model execution.

- **`POST /api/v1/runs`**
  - **Purpose**: Idempotently create a new diagnostic run.
  - **Auth**: Required (Technician, Manager, Admin, Owner).
  - **Request**: `roomId`, `deviceId`, `question`, `mediaIds`.
  - **Response**: `runId`, `status` ("queued"), `eventsUrl`.
- **`GET /api/v1/runs/:runId`**
  - **Purpose**: Retrieve the current state of a specific run.
  - **Auth**: Required (Must belong to user's tenant).
- **`GET /api/v1/runs/:runId/events`**
  - **Purpose**: Durable Server-Sent Events (SSE) stream of run state changes.
  - **Auth**: Required.
  - **Features**: Supports `Last-Event-ID` for seamless resumption without duplicate processing.

## 3. Devices
Telemetry and hardware inventory.

- **`GET /api/v1/devices/:deviceId/status`**
  - **Purpose**: Fetch simulated telemetry for a device.
  - **Auth**: Required.
  - **Response**: `DeviceStatus` (online, powerState, temperatureC, input, firmwareVersion).

## 4. Documents
Knowledge base ingestion.

- **`POST /api/v1/documents/ingestions`**
  - **Purpose**: Ingest manual/guide chunks for RAG.
  - **Auth**: Required (Manager, Admin, Owner).

## 5. Approvals
Managerial oversight for consequential actions.

- **`POST /api/v1/approvals/:runId/decision`**
  - **Purpose**: Approve or deny a consequential proposed step.
  - **Auth**: Required (Manager, Admin, Owner; cannot be original requester).
  - **Request**: `decision` ("approved", "denied"), `reason`, `proposalHash`.

## 6. Incidents
Actionable output from approved runs.

- **`GET /api/v1/incidents`**
  - **Purpose**: List incidents within the tenant.
  - **Auth**: Required.
- **`POST /api/v1/incidents/:incidentId/retry`**
  - **Purpose**: Manually retry a failed incident dispatch.
  - **Auth**: Required (Manager, Admin, Owner).

## 7. Webhooks
Integrations with n8n workflow.

- **`POST /api/webhook/deviceops-incident` (n8n Side)**
  - **Purpose**: Receive signed incident envelope from core outbox.
  - **Auth**: HMAC Signature (`N8N_WEBHOOK_SECRET`).
- **`POST /api/v1/webhooks/n8n/ack` (Core Side)**
  - **Purpose**: n8n acknowledges successful delivery of an incident.
  - **Auth**: HMAC Signature.

## 8. Media
Attachments and quarantine workflow.

- **`POST /api/v1/media/uploads`**
  - **Purpose**: Request a secure upload URL/intent.
  - **Auth**: Required.
  - **Request**: `kind`, `bytes`, `declaredMime`, `sha256`.
- **`POST /api/v1/media/:mediaId/complete`**
  - **Purpose**: Notify the server that upload is complete to begin quarantine scanning.
  - **Auth**: Required.
- **`GET /api/v1/media/:mediaId/content`**
  - **Purpose**: Retrieve the actual media bytes (only if scanning passed).
  - **Auth**: Required.
- **`GET /api/v1/media/:mediaId/metadata`**
  - **Purpose**: Check media quarantine/scan status.
  - **Auth**: Required.

## 9. Evaluation
Systematic retrieval and output checks.

- **`POST /api/v1/eval/runs`**
  - **Purpose**: Trigger an evaluation run programmatically.
  - **Auth**: Required (Admin, Owner).
- **`GET /api/v1/eval/runs/:evalId`**
  - **Purpose**: Retrieve evaluation benchmark results.
  - **Auth**: Required.

## 10. Health & Metrics
System observability.

- **`GET /healthz` / `GET /readyz`**
  - **Purpose**: Liveness and readiness probes.
  - **Auth**: None.
- **`GET /metrics`**
  - **Purpose**: Prometheus metrics exposition.
  - **Auth**: Internal Network / Configured Token.
