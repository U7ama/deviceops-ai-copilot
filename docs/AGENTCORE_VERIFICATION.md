# AgentCore deployment verification — September 8, 2026

## Result

Actual `CreateAgentRuntime` in `us-east-1` was rejected with:

```text
ServiceQuotaExceededException: maxAgents limit exceeded for account [redacted].
Please contact AWS Support for more information.
```

Read-only runtime listing succeeded in N. Virginia and Ohio and returned zero runtimes. This did not establish permission or capacity to deploy. The real creation attempt established the current deployment blocker.

## Applied quotas inspected through Service Quotas

| Quota | Code | us-east-1 | us-east-2 |
| --- | --- | --- | --- |
| Total Agents per Account | L-F4575653 | 0 | 0 |
| Endpoints per Agent | L-9B442722 | 0 | 0 |
| Versions per Agent | L-61A3A6D8 | 0 | 0 |
| Maximum size for a Docker image, MB | L-0A9E32B3 | 0 | 0 |

The first three are reported adjustable. The image-size quota is reported non-adjustable. The test used direct Python ZIP deployment, not a container image. Do not interpret published default quotas as this account's applied quotas.

## Test scope and cleanup

A minimal Python HTTP server was packaged with the AWS SDK. The intended test was runtime health followed by tiny Nova Lite, Titan embedding and Gemini requests. A temporary, narrowly scoped execution role and private encrypted S3 bucket were created. Runtime creation failed before any invocation. No Gemini key was sent to the service and no model inference ran. There was no AgentCore runtime execution; small S3 request/storage charges may apply and billing was not independently audited.

The probe archive and bucket were deleted, as was the temporary execution role and inline policy. Runtime listing remained empty in both checked regions. Existing DeviceOps services were untouched.

## Next step

Use AWS Service Quotas or AWS Support to enable usable AgentCore runtime quotas. Ask for at least one agent runtime plus nonzero endpoints/versions, and clarification of the zero image-size quota if deploying a container. The zero runtime quotas are separate observed evidence from the previous Bedrock inference restriction; no common underlying cause has been established. A quota change must be followed by another actual create/invoke test. No support message or quota-increase request was submitted by this test.

Suggested support text:

> AgentCore ListAgentRuntimes succeeds and returns zero runtimes, but CreateAgentRuntime in us-east-1 returns ServiceQuotaExceededException: maxAgents limit exceeded. Service Quotas reports Total Agents per Account (L-F4575653), Endpoints per Agent (L-9B442722), and Versions per Agent (L-61A3A6D8) all at zero in us-east-1 and us-east-2. Please enable usable runtime quotas for a small Strands hackathon deployment and explain any account eligibility prerequisite. The model provider can be external; runtime deployment itself is currently blocked.

References: [AWS runtime quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html), [CreateAgentRuntime API](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateAgentRuntime.html).
