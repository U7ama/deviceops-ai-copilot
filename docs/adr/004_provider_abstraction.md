# ADR 004: AI Model Provider Abstraction Layer

## Context
Production AI systems require decoupling from single model vendors for offline testing, evals, and fallback support.

## Decision
We implement a strict TypeScript \AiProvider\ interface with default \MockAiProvider\ (zero secret needed) and optional \OpenAiProvider\.
