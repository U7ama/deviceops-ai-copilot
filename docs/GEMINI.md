# Gemini investigations through Strands

Gemini is an explicitly selected reasoning provider. Bedrock remains available; provider failures escalate the incident and never trigger a cross-provider fallback. See [live provider verification](ENTERPRISE_RELEASE.md) for actual successes, failures, and remaining release gates.

## Local Docker configuration

In the ignored `.env.hackathon`, set these values privately:

```dotenv
OPS_AGENT_MODE=gemini
GEMINI_MODEL_ID=gemini-3.7-flash
GEMINI_API_KEY=your-private-key
GEMINI_USAGE_CONFIRMED=true
```

Only confirm usage after checking the Google API quota/billing settings. AWS credits do not cover Gemini. The key is passed only to the private Python service, never to the web app, worker or MCP subprocess. Do not paste keys into chat or commit them.

```sh
docker compose --env-file .env.hackathon -f compose.hackathon.yaml -f compose.enterprise.yaml -f compose.media-scan.yaml -f compose.gemini.yaml --profile gemini up -d --build web worker strands
```

This overlay removes the AWS credential mount. It defaults to the configured `gemini-3.7-flash` route. Earlier original-agent live scenarios succeeded, but the latest recorded authentication check returned HTTP 401 and the new specialist workflow remains unverified live. A healthy service does not prove successful inference. Keep fixture mode until a usable key and bounded live investigation are verified. No silent provider fallback is enabled.

For a host-run service, set `STRANDS_MODEL_PROVIDER=gemini`, `GEMINI_MODEL_ID=gemini-3.7-flash`, `GEMINI_API_KEY`, and `GEMINI_USAGE_CONFIRMED=true` in its private environment. Set `OPS_AGENT_MODE=gemini` and `GEMINI_USAGE_CONFIRMED=true` for the backend/worker as well. Existing service authentication and MCP configuration remain required. A mismatched backend/service provider is rejected.

## Preserved controls and retrieval

- Original investigations retain their configured limits; specialist mode permits at most 12 model calls, 24 evidence-tool calls, 180 seconds, 120,000 input tokens and 12,000 output tokens. Monetary reservations and provider quotas may stop work earlier.
- Usage and conservative reservations are enforced by the shared backend ledger and Python budget code. Provider switching does not reset spend. Application accounting is not a billing hard cap; inspect current pricing and quota before paid verification.
- Gemini mode uses explicit lexical runbook retrieval. It does not silently invoke Titan; Bedrock mode retains the optional Titan path.
- Tenant grants, evidence validation, approvals and simulator-only remediation remain backend-enforced.

Provider documentation: [Strands Gemini](https://strandsagents.com/docs/user-guide/concepts/model-providers/google/). Price/usage configuration must be checked before changing models; historical estimates in earlier logs are not current prices.

## Verification and honest submission claims

Offline tests exercise the installed Strands loop with mocked Gemini streams, including MCP-style tools, structured output, usage accounting, shrinking output allowance, missing usage, provider mismatch and credential isolation. They do not establish Google authorization or live diagnosis quality.

After configuring a usable key, run a simulator incident and verify actual `strands-gemini` evidence, approval behavior, one command, sustained recovery and report provenance. Record latency, token usage and estimated cost. Keep the UI, video and architecture diagram clear about the provider actually demonstrated. Bedrock remains implemented but subject to its account-access restriction.
