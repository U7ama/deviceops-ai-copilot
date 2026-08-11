# ADR 003: Hybrid Retrieval (PostgreSQL FTS + pgvector HNSW + RRF)

## Context
Keyword search misses semantic context, while pure vector search suffers on exact part numbers or device model codes.

## Decision
We combine PostgreSQL Full-Text Search (tsvector) and pgvector HNSW vector similarity search using Reciprocal Rank Fusion (RRF) with constant k=60.
