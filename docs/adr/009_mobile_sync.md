# ADR 009: Mobile Synchronization & Redacted Offline Cache

## Context
Field technicians in remote environments need device telemetry visibility without compromising security or executing offline actions.

## Decision
Expo mobile app caches device telemetry status locally using Expo SecureStore. Consequential execution offline is blocked; raw media, prompts, and tokens are redacted from offline storage.
