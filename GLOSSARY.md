# Glossary

This glossary defines key terms used throughout the DeviceOps architecture, codebase, and documentation.

- **Abstention**: The model's explicit refusal to provide a diagnosis or executable instruction when evidence is insufficient or prompts are adversarial.
- **Approval**: A cryptographically verifiable manager or admin decision required before a consequential incident proposal can be dispatched.
- **Chunk**: A delimited, embedding-indexed segment of an ingested manual or diagnostic guide used for retrieval-augmented generation.
- **Citation**: A verified reference within a diagnosis linking specific evidence (by ID and offset) to the exact retrieved chunk and version.
- **Dead letter**: An outbox event or durable job that permanently failed after exhausting all safe retry attempts and requires human intervention.
- **Device**: A simulated physical asset (e.g., display model) monitored for telemetry and status, bound to a specific room.
- **HMAC (Hash-based Message Authentication Code)**: A cryptographic signature used to verify the integrity and authenticity of incident webhook envelopes sent to n8n.
- **Idempotency**: The guarantee that submitting the same request (e.g., run creation or webhook acknowledgement) multiple times yields the same state without duplicate side-effects.
- **Incident**: A durable record of an actionable hardware or software issue, generated from an approved consequential run proposal.
- **Outbox**: A database table pattern used to atomically commit outgoing events (like `run.requested` or `incident.approved`) in the same transaction as the state change, ensuring guaranteed delivery despite crashes.
- **Quarantine**: The initial, isolated storage state for uploaded media files before they pass checksum verification and malware scanning.
- **RRF (Reciprocal Rank Fusion)**: A hybrid search technique combining traditional text matching (BM25) with vector embeddings to improve retrieval relevance.
- **RLS (Row-Level Security)**: A PostgreSQL database feature used as defense-in-depth to enforce tenant-level isolation directly at the database execution layer.
- **Room**: A hierarchical location boundary containing devices, scoped entirely within a single tenant.
- **Run**: A durable state machine instance tracking a single diagnostic session, encompassing user input, retrieval, provider calls, and diagnosis generation.
- **SSE (Server-Sent Events)**: A durable streaming protocol used to replay run events to the Next.js and Expo clients without repeating backend work.
- **Tenant**: The primary organizational and data isolation boundary; all rooms, devices, runs, and users belong to exactly one tenant.
