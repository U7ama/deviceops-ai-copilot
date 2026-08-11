import { getRunEvents } from "@deviceops/core";
import { authenticate, problem, problemFromError, requestMetadata, responseHeaders } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
  try {
    const { id } = await context.params;
    const headerSequence = request.headers.get("last-event-id") ?? "0";
    const after = /^\d+$/.test(headerSequence) ? BigInt(headerSequence) : 0n;
    await getRunEvents(session.user, id, after);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let cursor = after;
        const deadline = Date.now() + 25_000;
        try {
          while (Date.now() < deadline && !request.signal.aborted) {
            const events = await getRunEvents(session.user, id, cursor);
            for (const event of events) {
              cursor = BigInt(event.sequence);
              controller.enqueue(encoder.encode(
                `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
              ));
            }
            if (events.some((event) => event.type === "run.completed" || event.type === "run.failed")) break;
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
          controller.enqueue(encoder.encode("event: reconnect\ndata: {\"retryAfterMs\":1000}\n\n"));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });
    return new Response(stream, {
      status: 200,
      headers: {
        ...responseHeaders(metadata, "text/event-stream"),
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    return problemFromError(error, metadata);
  }
}
