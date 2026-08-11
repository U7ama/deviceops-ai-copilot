import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { ProblemDetails } from "@deviceops/contracts";
import { DomainError } from "@deviceops/core";
import { logStructured } from "@deviceops/observability";
import {
  findSessionContextByTokenHash,
  type SessionContext
} from "@deviceops/db";

export interface RequestMetadata {
  requestId: string;
  correlationId: string;
}

export function requestMetadata(request: Request): RequestMetadata {
  const requestId = randomUUID();
  const requestedCorrelation = request.headers.get("x-correlation-id");
  return {
    requestId,
    correlationId: requestedCorrelation && isUuid(requestedCorrelation)
      ? requestedCorrelation
      : requestId
  };
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
  if (!origin || origin !== configuredOrigin) {
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

export function problem(
  status: number,
  code: string,
  detail: string,
  metadata: RequestMetadata
): NextResponse<ProblemDetails> {
  const body: ProblemDetails = {
    type: `https://deviceops.local/problems/${code.toLowerCase()}`,
    title: code,
    status,
    detail,
    requestId: metadata.requestId,
    code
  };
  return NextResponse.json(body, {
    status,
    headers: responseHeaders(metadata, "application/problem+json")
  });
}

export function problemFromError(error: unknown, metadata: RequestMetadata): NextResponse {
  if (error instanceof DomainError || isDomainErrorLike(error)) {
    const domain = error as { status: number; code: string; message: string };
    return problem(domain.status, domain.code, domain.message, metadata);
  }
  logStructured("http.request.failed", {
    requestId: metadata.requestId,
    correlationId: metadata.correlationId,
    error: error instanceof Error ? error.message : "unknown"
  }, "error");
  return problem(500, "INTERNAL_ERROR", "The request could not be completed", metadata);
}

function isDomainErrorLike(error: unknown): error is { status: number; code: string; message: string } {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  return value.name === "DomainError"
    && typeof value.status === "number"
    && typeof value.code === "string"
    && typeof value.message === "string";
}

export function json<T>(body: T, metadata: RequestMetadata, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status, headers: responseHeaders(metadata, "application/json") });
}

export function responseHeaders(metadata: RequestMetadata, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "X-Request-ID": metadata.requestId,
    "X-Correlation-ID": metadata.correlationId,
    "Cache-Control": "no-store"
  };
}

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

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
