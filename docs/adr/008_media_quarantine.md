# ADR 008: Quarantined Media Lifecycle & Fail-Closed Scanning

## Context
Technician uploads (images/voice) present malware, EXIF tracking, and prompt injection vulnerabilities.

## Decision
Uploads enter a strict quarantine state (`created -> uploading -> quarantined -> scanning -> ready`). ClamAV scanner errors default to fail-closed (`quarantined`). EXIF/GPS metadata is stripped before attachment.
