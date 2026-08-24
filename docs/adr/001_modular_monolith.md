# ADR 001: Modular Monolith with Separate Background Worker

## Context
DeviceOps AI Copilot requires high cohesion across contracts, schemas, auth, and AI reasoning. Microservice overhead would introduce unnecessary network latency and deployment complexity.

## Decision
We adopt an npm workspace modular monolith architecture (`apps/web`, `apps/worker`, `apps/mcp`, `packages/*`). PostgreSQL with pg-boss handles background jobs.

## Consequences
- Unified TypeScript type safety across apps and packages.
- Low operational overhead.
