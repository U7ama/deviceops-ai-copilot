# ADR 006: Transactional Outbox Pattern for Side-Effects

## Context
Side-effects such as webhook notifications must execute reliably without blocking API HTTP responses or risking ghost dispatches.

## Decision
All state transitions write outbox records in the same PostgreSQL database transaction. Worker processes consume the outbox queue reliably via pg-boss.
