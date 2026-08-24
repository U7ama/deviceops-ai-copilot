# ADR 004: AI Model Provider Abstraction Layer

## Context
Production AI systems require decoupling from single model vendors for offline testing, evals, and fallback support.

## Decision
We implement a strict TypeScript `AiProvider` interface supporting production `OpenAiProvider` alongside a deterministic `MockAiProvider` for offline CI test suites and evaluation benchmarks.
