import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyPassword, secureCookie } from "@deviceops/auth";
import { LoginRequestSchema } from "@deviceops/contracts";
import { adminSql } from "@deviceops/db";
import { logStructured, metrics } from "@deviceops/observability";
import { json, problem, requestMetadata, sha256 } from "@/lib/http";

const WEB_SESSION_MS = 24 * 60 * 60 * 1000;
const MOBILE_ACCESS_MS = 15 * 60 * 1000;
const MOBILE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const metadata = requestMetadata(request);
  try {
    const parsed = LoginRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return problem(400, "INVALID_PAYLOAD", "Email, password, and client are required", metadata);
    }
    if (parsed.data.client === "web") {
      const expectedOrigin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
      const origin = request.headers.get("origin");
      if (origin && origin !== expectedOrigin) {
        return problem(403, "ORIGIN_DENIED", "Request origin is not allowed", metadata);
      }
    }
    const [user] = await adminSql()<
      Array<{
        id: string;
        email: string;
        display_name: string;
        password_hash: string;
        locked_until: string | null;
        tenant_id: string;
        tenant_name: string;
        role: "owner" | "admin" | "manager" | "technician" | "viewer";
        demo_mode: boolean;
      }>
    >`
      select u.id, u.email, u.display_name, u.password_hash, u.locked_until,
             t.id as tenant_id, t.name as tenant_name, m.role, t.demo_mode
      from users u
      join memberships m on m.user_id = u.id
      join tenants t on t.id = m.tenant_id
      where lower(u.email) = ${parsed.data.email}
      order by t.created_at asc
      limit 1
    `;
    const locked = user?.locked_until && new Date(user.locked_until).getTime() > Date.now();
    const valid = user && !locked
      ? await verifyPassword(user.password_hash, parsed.data.password)
      : false;
    if (!user || !valid) {
      if (user && !locked) {
        await adminSql()`
          update users
          set failed_logins = failed_logins + 1,
              locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else null end
          where id = ${user.id}
        `;
      }
      metrics.increment("deviceops_auth_login_total", { ok: false });
      logStructured("auth.login.denied", { requestId: metadata.requestId, reason: locked ? "locked" : "credentials" }, "warn");
      return problem(locked ? 429 : 401, locked ? "ACCOUNT_LOCKED" : "UNAUTHORIZED", locked
        ? "The account is temporarily locked"
        : "Invalid email or password", metadata);
    }

    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = parsed.data.client === "mobile"
      ? randomBytes(48).toString("base64url")
      : null;
    const csrfToken = parsed.data.client === "web"
      ? randomBytes(32).toString("base64url")
      : null;
    const accessExpiresAt = new Date(Date.now() + (parsed.data.client === "web" ? WEB_SESSION_MS : MOBILE_ACCESS_MS));
    const refreshExpiresAt = refreshToken ? new Date(Date.now() + MOBILE_REFRESH_MS) : null;
    await adminSql().begin(async (transaction) => {
      await transaction`update users set failed_logins = 0, locked_until = null where id = ${user.id}`;
      await transaction`
        insert into sessions
          (id, user_id, tenant_id, kind, token_hash, refresh_hash, csrf_hash,
           expires_at, refresh_expires_at)
        values
          (${randomUUID()}, ${user.id}, ${user.tenant_id}, ${parsed.data.client}, ${sha256(accessToken)},
           ${refreshToken ? sha256(refreshToken) : null}, ${csrfToken ? sha256(csrfToken) : null},
           ${accessExpiresAt.toISOString()}, ${refreshExpiresAt?.toISOString() ?? null})
      `;
    });
    const body = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        tenantId: user.tenant_id,
        tenantName: user.tenant_name,
        role: user.role,
        demoMode: user.demo_mode
      },
      accessToken: parsed.data.client === "mobile" ? accessToken : undefined,
      refreshToken: refreshToken ?? undefined,
      csrfToken: csrfToken ?? undefined,
      expiresAt: accessExpiresAt.toISOString()
    };
    const response: NextResponse = json(body, metadata);
    if (parsed.data.client === "web" && csrfToken) {
      response.cookies.set("deviceops_session", accessToken, secureCookie(accessExpiresAt, true));
      response.cookies.set("deviceops_csrf", csrfToken, secureCookie(accessExpiresAt, false));
    }
    metrics.increment("deviceops_auth_login_total", { ok: true, client: parsed.data.client });
    logStructured("auth.login.succeeded", { requestId: metadata.requestId, userId: user.id, tenantId: user.tenant_id });
    return response;
  } catch (error) {
    logStructured("auth.login.failed", { requestId: metadata.requestId, error: error instanceof Error ? error.message : "unknown" }, "error");
    return problem(500, "AUTHENTICATION_FAILED", "Authentication is temporarily unavailable", metadata);
  }
}
