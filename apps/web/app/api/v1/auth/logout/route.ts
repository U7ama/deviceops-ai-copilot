import { adminSql } from "@deviceops/db";
import { authenticate, json, problem, problemFromError, requestMetadata, requireMutationProtection } from "@/lib/http";

export async function POST(request: Request) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  const response = json({ loggedOut: true }, metadata);
  response.cookies.set("deviceops_session", "", { path: "/", maxAge: 0 });
  response.cookies.set("deviceops_csrf", "", { path: "/", maxAge: 0 });
  if (!session) return response;
  try {
    requireMutationProtection(request, session);
    await adminSql()`update sessions set revoked_at = now() where id = ${session.sessionId}`;
    return response;
  } catch (error) {
    return response;
  }
}
