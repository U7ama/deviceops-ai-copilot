import { CreateRunRequestSchema } from "@deviceops/contracts";
import { createRun, listRuns } from "@deviceops/core";
import { queue } from "@deviceops/db";
import { logStructured } from "@deviceops/observability";
import {
  authenticate,
  json,
  problem,
  problemFromError,
  requestMetadata,
  requireMutationProtection
} from "@/lib/http";

export async function POST(request: Request) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
  try {
    requireMutationProtection(request, session);
    const parsed = CreateRunRequestSchema.safeParse(await request.json());
    if (!parsed.success) return problem(400, "INVALID_REQUEST", "Run request is invalid", metadata);
    const response = await createRun({
      actor: session.user,
      request: parsed.data,
      idempotencyKey: request.headers.get("idempotency-key") ?? "",
      correlationId: metadata.correlationId
    });
    try {
      const boss = await queue();
      await boss.createQueue("process-run");
      await boss.send("process-run", {
        runId: response.runId,
        tenantId: session.user.tenantId,
        requesterId: session.user.id
      }, { singletonKey: response.runId, retryLimit: 5, retryBackoff: true });
    } catch (error) {
      logStructured("run.queue.deferred", {
        runId: response.runId,
        error: error instanceof Error ? error.message : "unknown"
      }, "warn");
    }
    return json(response, metadata, 202);
  } catch (error) {
    return problemFromError(error, metadata);
  }
}

export async function GET(request: Request) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
    return json({ runs: await listRuns(session.user, limit) }, metadata);
  } catch (error) {
    return problemFromError(error, metadata);
  }
}
