# Reviewable AWS hosting package

Nothing here has been deployed. The local fixture stack is the verified development target; this package prepares a single-host application demonstration. Actual AWS credit balance, account access, regional model permissions and monthly costs must be checked before creating resources.

`host.cloudformation.json` defines one `t3a.medium` host with 32 GiB encrypted gp3, an SSM administration role, narrowly scoped Nova Lite/Titan inference permissions, a CloudFront HTTPS URL with caching disabled, and an origin security group limited to the CloudFront managed prefix list. There is no public SSH, database, Strands, n8n or Mailpit port. It uses an existing public subnet/VPC in **us-east-1**. No application or credential is embedded in instance user data.

This is a prepared template, not a verified deployment. JSON syntax can be checked locally; AWS `validate-template`, account quotas, the regional CloudFront prefix-list ID, and a real deployment are still required. Verify the inference profile's destination regions against [AWS documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html) before applying its IAM policy.

## Funding and installation sequence

1. Confirm usable promotional credit balance, expiry and covered services in AWS Billing. Set the explicit funding attestation only after that check. Estimate the planned hosting period with [AWS Pricing Calculator](https://calculator.aws/), including compute, EBS, public IPv4, CloudFront requests/egress and model tokens. The application $6 model ledger does not cap other AWS charges or other callers. Keep the full project below the user's $50 ceiling; do not provision if the verified estimate exceeds it.
2. Review the template and parameter values, then create a CloudFormation change set. Creating/executing a real stack is a separate external action. The template requires IAM acknowledgement. Configure billing alerts; alerts do not stop spending.
3. Connect through SSM. Install Docker/Compose following their official Linux instructions, and install Caddy or another equivalent reverse proxy. Copy the reviewed source to the host. Keep n8n optional and local; avoid running development servers for public access.
4. Generate `.env.demo` using `node scripts/demo-env.mjs`. Set `APP_URL` to the CloudFront HTTPS output and keep fixture mode for the first smoke test. Keep `.env.demo` private. Configure the same private origin token used by the stack as `DEVICEOPS_ORIGIN_SECRET` for Caddy; the provided `Caddyfile` rejects requests without it and proxies approved origin requests to localhost:3030.
5. Use both Compose files, in order, for all hosted commands:

   ```sh
   docker compose --env-file .env.demo -f compose.demo.yaml -f compose.hosted.yaml up -d postgres
   docker compose --env-file .env.demo -f compose.demo.yaml -f compose.hosted.yaml run --build --rm migrate
   docker compose --env-file .env.demo -f compose.demo.yaml -f compose.hosted.yaml run --rm seed
   docker compose --env-file .env.demo -f compose.demo.yaml -f compose.hosted.yaml up -d web worker
   ```

6. Verify HTTPS login, secure cookies, tenant isolation, exact approval hashes, SSE/reconnect, every fixture scenario and restart persistence through the public URL. Share dedicated demo credentials privately; do not publish credentials in the repository.
7. Only after credits and model access are confirmed, set `OPS_AGENT_MODE=bedrock` and `AWS_CREDITS_CONFIRMED=true`, build/start the `bedrock` profile, and run a small real investigation. The hosted overlay uses the instance role, with no static AWS credential mount. Capture provider/model, token usage, citations and recovery outcome. Keep the service private and single-worker.

The instance role is available to host containers through IMDSv2 with a hop limit of two; this is a small-demo trust boundary, not per-container IAM isolation. Device credentials must remain in the edge vault. Persist `.data` and database volumes; back up evidence before rebuilding or deleting the stack. Stack deletion terminates its instance and root volume, so preserve any required data first. An EIP is intentionally not provisioned; replacement of the host requires updating and retesting the CloudFront origin.

## Demonstration access and teardown

Keep the functioning build available for the planned demonstration period. Monitor costs and model budget daily while it is hosted. After the period, export evidence, stop workloads, disable/delete the distribution, then remove the approved stack and verify remaining volumes/public addresses. Do not treat stopping EC2 as eliminating EBS or other charges.

## Local image prerequisite

`Dockerfile.local` uses a prepared dependency image; it is not a self-contained clean-clone build. Preserve existing local images. The portable hosted build is defined in `Dockerfile.production`; validate it independently before using it for hosting.
