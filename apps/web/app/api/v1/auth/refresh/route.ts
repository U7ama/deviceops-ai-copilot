import { randomBytes } from "node:crypto";
import { z } from "zod";
import { adminSql } from "@deviceops/db";
import { json, problem, requestMetadata, sha256 } from "@/lib/http";

const RefreshSchema = z.object({ refreshToken: z.string().min(32).max(256) }).strict();

export async function POST(request: Request) {
  const metadata = requestMetadata(request);
  const parsed = RefreshSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, "INVALID_PAYLOAD", "A refresh token is required", metadata);
  const nextAccess = randomBytes(32).toString("base64url");
  const nextRefresh = randomBytes(48).toString("base64url");
  const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [session] = await adminSql()<Array<{ id: string }>>`
    update sessions
    set token_hash = ${sha256(nextAccess)}, refresh_hash = ${sha256(nextRefresh)},
        expires_at = ${accessExpiresAt.toISOString()}, refresh_expires_at = ${refreshExpiresAt.toISOString()},
        last_seen_at = now()
    where kind = 'mobile'
      and refresh_hash = ${sha256(parsed.data.refreshToken)}
      and refresh_expires_at > now()
      and revoked_at is null
    returning id
  `;
  if (!session) return problem(401, "REFRESH_REJECTED", "Refresh token expired or was already rotated", metadata);
  return json({ accessToken: nextAccess, refreshToken: nextRefresh, expiresAt: accessExpiresAt.toISOString() }, metadata);
}
