# ADR 002: PostgreSQL Row-Level Security (RLS) for Multi-Tenancy

## Context
Multi-tenant applications face data leakage risks if tenant filtering relies solely on application-layer WHERE clauses.

## Decision
We enforce Row-Level Security (RLS) on all tenant-bound tables in PostgreSQL. The application connects using a non-owner database role (`deviceops_app`) and sets `app.current_tenant_id` per transaction context.

## Consequences
- Guaranteed tenant data isolation at the database engine level.
