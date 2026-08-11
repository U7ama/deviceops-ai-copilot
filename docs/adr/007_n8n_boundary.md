# ADR 007: n8n Signed Webhook Boundary

## Context
External notification and escalation workflows must be decoupled from core application security.

## Decision
n8n receives external work only. All webhooks are signed using HMAC-SHA256 with timestamp, nonce, and delivery ID. Core API maintains ground truth.
