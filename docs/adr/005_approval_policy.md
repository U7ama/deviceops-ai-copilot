# ADR 005: Server-Derived Risk Classification & Approval Policy

## Context
Model outputs are non-deterministic and must never serve as security or approval boundaries.

## Decision
The server application evaluates risk class (`read_only`, `consequential`) and approval requirements deterministically based on tool proposals and requester role (`requester_id != approver_id`).
