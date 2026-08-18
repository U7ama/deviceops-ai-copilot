import { createHash, timingSafeEqual } from "node:crypto";
import { DomainError } from "@deviceops/core";
import { findSessionContextByTokenHash, type SessionContext } from "@deviceops/db";
import { verify, hash } from "@node-rs/argon2";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...rawValue] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}

export async function authenticate(request: Request): Promise<SessionContext | null> {
  const token = bearerToken(request) ?? cookieValue(request, "deviceops_session");
  if (!token || token.length > 256) return null;
  const tokenHash = sha256(token);
  return findSessionContextByTokenHash(tokenHash);
}

export function requireMutationProtection(request: Request, session: SessionContext): void {
  if (session.kind === "mobile") return;
  const configuredOrigin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
  const origin = request.headers.get("origin");
  const isAllowedOrigin =
    origin === configuredOrigin ||
    (process.env.NODE_ENV !== "production" &&
      (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000"));
  if (!origin || !isAllowedOrigin) {
    throw new DomainError("ORIGIN_DENIED", "Request origin is not allowed", 403);
  }
  const headerToken = request.headers.get("x-csrf-token");
  const cookieToken = cookieValue(request, "deviceops_csrf");
  if (!headerToken || !cookieToken || headerToken !== cookieToken || !session.csrfHash) {
    throw new DomainError("CSRF_DENIED", "CSRF validation failed", 403);
  }
  const actual = Buffer.from(sha256(headerToken));
  const expected = Buffer.from(session.csrfHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new DomainError("CSRF_DENIED", "CSRF validation failed", 403);
  }
}

export async function verifyPassword(hashString: string, plain: string): Promise<boolean> {
  return verify(hashString, plain);
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export function secureCookie(expires: Date, httpOnly: boolean) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    expires
  };
}
