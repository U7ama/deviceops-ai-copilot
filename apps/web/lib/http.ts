import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ProblemDetails } from "@deviceops/contracts";
import { DomainError } from "@deviceops/core";
import { logStructured } from "@deviceops/observability";
import {
  authenticate,
  requireMutationProtection,
  sha256,
  cookieValue
} from "@deviceops/auth";

export { authenticate, requireMutationProtection, sha256, cookieValue };

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
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
