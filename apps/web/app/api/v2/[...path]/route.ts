import { z } from "zod";
import { integrationCatalog } from "@deviceops/connectors";
import {
  getState,
  getIncident,
  listIncidents,
  mutate,
  eventsFor,
  callTool,
  collectorRequest,
  enrollCollector,
  reindexRunbooks,
  claimNotification,
  acknowledgeNotification,
  OpsError,
} from "@deviceops/operations";
import {
  authenticate,
  requireMutationProtection,
  json,
  problem,
  problemFromError,
  requestMetadata,
} from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function body(request: Request) {
  const limit = 262144;
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new OpsError(413, "BODY_TOO_LARGE", "Request too large");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new OpsError(413, "BODY_TOO_LARGE", "Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
async function handle(request: Request, context: Context) {
  const metadata = requestMetadata(request);
  try {
    const path = (await context.params).path.join("/");
    const token =
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (path === "internal/notifications/claim" && request.method === "POST")
      return json(await claimNotification(await body(request)), metadata);
    if (path === "internal/notifications/ack" && request.method === "POST")
      return json(await acknowledgeNotification(await body(request)), metadata);
    if (path === "internal/tools" && request.method === "POST") {
      const input = z
        .object({
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()).default({}),
        })
        .strict()
        .parse(await body(request));
      return json(await callTool(token, input.name, input.arguments), metadata);
    }
    if (path.startsWith("collector/")) {
      const sub = path.slice(10);
      if (
        (sub === "commands" && request.method !== "GET") ||
        (sub !== "commands" && request.method !== "POST")
      )
        return problem(
          405,
          "METHOD_NOT_ALLOWED",
          "Wrong collector method",
          metadata,
        );
      return json(
        await collectorRequest(
          token,
          sub,
          request.method === "POST" ? await body(request) : {},
        ),
        metadata,
      );
    }
    const session = await authenticate(request);
    if (!session)
      return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
    if (request.method === "GET") {
      if (path === "state") {
        const state = await getState(session.user);
        return json({ ...state, connectors: integrationCatalog }, metadata);
      }
      if (path === "devices") {
        const state = await getState(session.user);
        return json({ devices: state.devices }, metadata);
      }
      if (path === "incidents")
        return json({ incidents: await listIncidents(session.user) }, metadata);
      if (/^incidents\/[^/]+$/.test(path))
        return json(
          await getIncident(session.user, path.split("/")[1]!),
          metadata,
        );
      if (path === "events") {
        let cursor =
          request.headers.get("last-event-id") ??
          new URL(request.url).searchParams.get("after") ??
          "0";
        if (!/^\d{1,20}$/.test(cursor)) cursor = "0";
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              const deadline = Date.now() + 20000;
              while (Date.now() < deadline && !request.signal.aborted) {
                const current = await authenticate(request);
                if (!current || current.user.tenantId !== session.user.tenantId)
                  break;
                for (const e of await eventsFor(
                  session.user.tenantId,
                  session.user.id,
                  cursor,
                )) {
                  cursor = e.sequence;
                  controller.enqueue(
                    encoder.encode(
                      `id: ${cursor}\nevent: operation\ndata: ${JSON.stringify(e)}\n\n`,
                    ),
                  );
                }
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
                await new Promise((r) => setTimeout(r, 1000));
              }
              controller.close();
            } catch (e) {
              controller.error(e);
            }
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      }
      return problem(404, "NOT_FOUND", "Endpoint not found", metadata);
    }
    requireMutationProtection(request, session);
    if (path === "runbooks/reindex")
      return json(await reindexRunbooks(session.user), metadata);
    if (path === "collectors")
      return json(
        await enrollCollector(session.user, await body(request)),
        metadata,
        201,
      );
    return json(
      await mutate(
        session.user,
        path,
        await body(request),
        request.headers.get("idempotency-key") ?? "",
      ),
      metadata,
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return problem(
        400,
        "INVALID_REQUEST",
        "Payload failed schema validation",
        metadata,
      );
    return problemFromError(error, metadata);
  }
}
export const GET = handle;
export const POST = handle;
