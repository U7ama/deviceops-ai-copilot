import { randomBytes } from "node:crypto";
import { adminSql } from "@deviceops/db";
import { authenticate, json, problem, requestMetadata, sha256 } from "@/lib/http";

export async function GET(request: Request) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
  if (session.kind !== "web") return problem(400, "CSRF_NOT_REQUIRED", "Mobile sessions use bearer authentication", metadata);
  const token = randomBytes(32).toString("base64url");
  await adminSql()`
    update sessions set csrf_hash = ${sha256(token)}, last_seen_at = now()
    where id = ${session.sessionId} and revoked_at is null
  `;
  const response = json({ csrfToken: token }, metadata);
  response.cookies.set("deviceops_csrf", token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 24 * 60 * 60
  });
  return response;
}
