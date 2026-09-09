# Gemini investigations through Strands

Gemini is an explicitly selected reasoning provider. Bedrock remains available; provider failures escalate the incident and never trigger a cross-provider fallback. See [live provider verification](LIVE_PROVIDER_VERIFICATION.md) for actual successes, failures, and remaining release gates.

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
docker compose --env-file .env.hackathon -f compose.hackathon.yaml -f compose.gemini.yaml --profile gemini up -d --build web worker strands
```

This overlay removes the AWS credential mount. It defaults to `gemini-3.7-flash`, verified for live inference with this account. The older `gemini-2.5-flash` adapter remains selectable, but actual inference returned 404 despite metadata listing it. No other Gemini model is accepted without reviewing its pricing and token limits. The web dashboard displays **Strands + Google Gemini** and each diagnosis records `strands-gemini` and the model ID. Health status only confirms process readiness, not successful inference.

For a host-run service, set `STRANDS_MODEL_PROVIDER=gemini`, `GEMINI_MODEL_ID=gemini-3.7-flash`, `GEMINI_API_KEY`, and `GEMINI_USAGE_CONFIRMED=true` in its private environment. Set `OPS_AGENT_MODE=gemini` and `GEMINI_USAGE_CONFIRMED=true` for the backend/worker as well. Existing service authentication and MCP configuration remain required. A mismatched backend/service provider is rejected.

## Preserved controls and retrieval

- Eight model calls, twelve investigation tool calls, 120-second subprocess deadline, 120,000 total input tokens and 8,000 total output tokens maximum.
- Provider retries disabled; missing usage fails closed. Gemini 3.7 uses low thinking; 2.5 disables thinking. Reported thinking tokens count as output.
- Gemini 3.7 reserves $0.24 per invocation, using conservative post-introductory rates of $1.50 input / $7.50 output per million tokens. Its current introductory prices are lower, and this free-tier key may incur no charges; the ledger deliberately retains the conservative estimate. Gemini 2.5 reserves $0.10 at $0.30/$2.50 per million. Unknown outcomes retain their reservation as estimated spend.
- The existing durable model ledger is shared across providers (its legacy database key remains `bedrock` to preserve prior spend). Provider switching does not reset the budget. This ledger is not a Google billing hard cap.
- Gemini mode uses explicit lexical runbook retrieval. It does not invoke Titan or mix embedding spaces; `/embed` is disabled in Gemini mode. Bedrock mode retains Titan.
- Tenant grants, evidence validation, approvals and simulator-only remediation remain backend-enforced.

Pricing reference checked September 8, 2026: https://ai.google.dev/gemini-api/docs/pricing . Strands provider documentation: https://strandsagents.com/docs/user-guide/concepts/model-providers/google/ . Recheck pricing before changing the model or releasing.

## Verification and honest submission claims

Offline tests exercise the installed Strands loop with mocked Gemini streams, including MCP-style tools, structured output, usage accounting, shrinking output allowance, missing usage, provider mismatch and credential isolation. They do not establish Google authorization or live diagnosis quality.

After configuring a usable key, run a simulator incident and verify actual `strands-gemini` evidence, approval behavior, one command, sustained recovery and report provenance. Record latency, token usage and estimated cost. Keep the UI, video and architecture diagram clear about the provider actually demonstrated. Bedrock remains implemented but subject to its account-access restriction.
