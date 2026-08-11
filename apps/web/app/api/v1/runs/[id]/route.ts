import { getRun } from "@deviceops/core";
import { authenticate, json, problem, problemFromError, requestMetadata } from "@/lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
  try {
    const { id } = await context.params;
    return json({ run: await getRun(session.user, id) }, metadata);
  } catch (error) {
    return problemFromError(error, metadata);
  }
}
