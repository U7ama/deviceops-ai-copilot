import { listDevices } from "@deviceops/core";
import { authenticate, json, problem, problemFromError, requestMetadata } from "@/lib/http";

export async function GET(request: Request) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
  try {
    return json({ devices: await listDevices(session.user) }, metadata);
  } catch (error) {
    return problemFromError(error, metadata);
  }
}
