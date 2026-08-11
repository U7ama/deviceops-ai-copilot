import { authenticate, json, problem, requestMetadata } from "@/lib/http";

export async function GET(request: Request) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  return session
    ? json({ user: session.user, sessionKind: session.kind }, metadata)
    : problem(401, "UNAUTHORIZED", "Session expired or revoked", metadata);
}
