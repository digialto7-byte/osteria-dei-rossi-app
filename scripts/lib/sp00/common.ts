// SP0 spike: small helpers shared by the check modules (T1, T2, T3, T5). No secret key is handled here.
import type { CaseReport, Cleanup } from "./report";

export const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export interface Session {
  accessToken: string;
  refreshToken: string;
}
/** What an Auth call gave back: the HTTP status when there was an answer, the error code if any, and the session if issued. */
export interface AuthResult {
  status: number | null;
  code: string | null;
  session: Session | null;
}

/** The claims of a USER access token (never the secret key). Null when the token is not a readable JWT. */
export function claimsOf(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (payload === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every listed case, not run, for one stated reason. */
export function notRun(ids: readonly string[], reason: string): CaseReport[] {
  return ids.map((id) => ({ id, result: "inconclusive", detail: { reason } }));
}

/**
 * Runs one case. A thrown error (network, parse) is reported as inconclusive with its class name, never its message (it may hold a URL);
 * it is not swallowed, and the check is then not ok.
 */
export async function attemptCase(id: string, run: () => Promise<CaseReport>): Promise<CaseReport> {
  try {
    return await run();
  } catch (error) {
    return {
      id,
      result: "inconclusive",
      detail: { reason: "request failed", error: errorName(error) },
    };
  }
}

/** A refused Auth answer: HTTP 429 is "could not be judged" (inconclusive, to be re-run once), anything else is a fail. */
export function refusedCase(
  id: string,
  status: number | null,
  code: string | null,
  extra: CaseReport["detail"] = {},
): CaseReport {
  return {
    id,
    result: status === 429 ? "inconclusive" : "fail",
    detail: { ...extra, status, code },
  };
}

/**
 * A check that failed unexpectedly after it had collected cases and created users. It carries both, so that the entry script reports what was
 * done (and what was left behind) and adds one inconclusive case for the crash, instead of replacing everything.
 */
export class CheckCrash extends Error {
  readonly partial: { cases: CaseReport[]; cleanup: Cleanup };
  constructor(cause: unknown, partial: { cases: CaseReport[]; cleanup: Cleanup }) {
    super("A check crashed after it had started.", { cause });
    this.name = "CheckCrash";
    this.partial = partial;
  }
}

/** Runs a setup step; if it throws, the error leaves as a CheckCrash carrying the cleanup counts known so far. */
export async function crashKeeping<T>(cleanup: () => Cleanup, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new CheckCrash(error, { cases: [], cleanup: { ...cleanup() } });
  }
}
