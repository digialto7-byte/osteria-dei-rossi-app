import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { readCronEnv } from "@/lib/env";
import { reportError } from "@/lib/observability/report";

const BEARER = /^Bearer (.+)$/i;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time comparison: equal-length digests, so the token's length is not leaked either. */
function matches(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Wraps a scheduled-job route (called by pg_net, no user session). Order: POST only → the
 * CRON_SECRET must be configured (fails closed) → Authorization: Bearer must match, before any
 * database or provider call. The handler's return value is sent as JSON.
 */
export function withCron(
  handler: (request: Request) => Promise<unknown>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let response: Response;
    try {
      if (request.method !== "POST") {
        throw new ApiError(405, "method_not_allowed", "Metodo non consentito.");
      }
      const { cronSecret } = readCronEnv();
      const provided = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
      if (provided === undefined || !matches(provided, cronSecret)) {
        throw new ApiError(401, "unauthenticated", "Accesso richiesto.");
      }
      response = Response.json(await handler(request));
    } catch (error) {
      if (error instanceof ApiError) {
        response = errorResponse(error.status, error.code, error.message);
        if (error.status === 405) response.headers.set("allow", "POST");
      } else {
        reportError(error);
        response = errorResponse(500, "internal", "Errore interno.");
      }
    }
    response.headers.set("cache-control", "no-store");
    return response;
  };
}
