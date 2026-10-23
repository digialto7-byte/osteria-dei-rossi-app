import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { ConfigError, readCronEnv } from "@/lib/env";
import { reportError } from "@/lib/observability/report";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const BEARER = /^Bearer (.+)$/i;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time comparison: equal-length digests, so the token's length is not leaked either. */
function matches(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

/** Job names app.job_run accepts (its check constraint); widen both together. */
export type CronJob = "extract";

export interface CronOptions<T> {
  job: CronJob;
  /** How many items one run handled, from the handler's result (stored in job_run.items). */
  countItems: (result: T) => number;
}

/** Codes for job_run.error_code: lower-case words, no messages (app.job_run's check). */
const CONFIG_MISSING = "config_missing";
const API_ERROR = "api_error";
const INTERNAL = "internal";

/**
 * Reports a failed job_run call by its code only: the error text could carry anything, and the
 * run record must never break the job it records.
 */
function reportRunFailure(step: "start" | "finish", cause: unknown) {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "unknown";
  reportError(new Error(`job_run_${step} failed: ${code}`));
}

async function startRun(admin: SupabaseClient, job: CronJob): Promise<number | null> {
  try {
    const { data, error } = await admin.rpc("job_run_start", { p_job: job });
    if (error || typeof data !== "number") {
      reportRunFailure("start", error ?? { code: "no_id" });
      return null;
    }
    return data;
  } catch (error) {
    reportRunFailure("start", error);
    return null;
  }
}

async function finishRun(
  admin: SupabaseClient,
  runId: number | null,
  outcome: { ok: boolean; errorCode: string | null; items: number },
) {
  if (runId === null) return;
  try {
    const { error } = await admin.rpc("job_run_finish", {
      p_id: runId,
      p_ok: outcome.ok,
      p_error_code: outcome.errorCode,
      p_items: outcome.items,
    });
    if (error) reportRunFailure("finish", error);
  } catch (error) {
    reportRunFailure("finish", error);
  }
}

/**
 * Wraps a scheduled-job route (called by pg_net, no user session). Order: POST only → the
 * CRON_SECRET must be configured (fails closed) → Authorization: Bearer must match, before any
 * database or provider call. Only then is the secret-key client created and the run recorded in
 * app.job_run (start → handler → finish); a refused call records nothing. A run that cannot be
 * recorded is reported and the handler still runs. The handler gets the request and that client;
 * its return value is sent as JSON.
 */
export function withCron<T>(
  options: CronOptions<T>,
  handler: (request: Request, admin: SupabaseClient) => Promise<T>,
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
      const admin = createSupabaseAdminClient();
      const runId = await startRun(admin, options.job);
      let result: T;
      let items: number;
      try {
        result = await handler(request, admin);
        items = options.countItems(result);
      } catch (error) {
        const errorCode =
          error instanceof ConfigError
            ? CONFIG_MISSING
            : error instanceof ApiError
              ? API_ERROR
              : INTERNAL;
        await finishRun(admin, runId, { ok: false, errorCode, items: 0 });
        throw error;
      }
      await finishRun(admin, runId, { ok: true, errorCode: null, items });
      response = Response.json(result);
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
