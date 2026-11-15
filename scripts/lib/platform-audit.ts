import { z } from "zod";

// SP3 step 5 (docs/plans/2026-11-15-sp3-console.md section 3.9.2): every state-changing script records one platform audit row after its own change succeeded, through
// platform_record_script_run (service role only). A failure to write the row is a failure of the run: the callers print AUDIT_NOT_WRITTEN and exit 1. Nothing here
// prints or keeps a raw error message, a detail value or an id: the message is the fixed text and one code.

export const AUDIT_NOT_WRITTEN = "audit not written";

export class AuditNotWrittenError extends Error {
  constructor(code: string) {
    super(`${AUDIT_NOT_WRITTEN} (${code})`);
    this.name = "AuditNotWrittenError";
  }
}

/** The one part of the secret-key client this helper uses. */
export interface AuditClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** What `detail` may hold (the database checks it again): flat, codes and ids only, never an address. */
export type AuditDetail = Record<string, string | number | boolean | null>;

/** A fixed error name of ours may be shown; anything else only as its code. */
function codeOf(error: { message: string; code?: string }): string {
  return /^[a-z_]{1,60}$/.test(error.message) ? error.message : (error.code ?? "unknown_error");
}

/**
 * Writes one platform audit row with origin `script`. Call it after the script's own change succeeded and only then. Throws AuditNotWrittenError when the row was
 * not written, with the code only.
 */
export async function recordScriptRun(
  admin: AuditClient,
  action: string,
  tenantId: string | null,
  detail: AuditDetail,
): Promise<void> {
  let answer: Awaited<ReturnType<AuditClient["rpc"]>>;
  try {
    answer = await admin.rpc("platform_record_script_run", {
      p_action: action,
      p_tenant: tenantId,
      p_detail: detail,
    });
  } catch {
    // The reason is not shown: a thrown error can carry a request URL or a value. The run still fails, with this fixed code.
    throw new AuditNotWrittenError("unreachable");
  }
  if (answer.error) throw new AuditNotWrittenError(codeOf(answer.error));
  if (!z.number().int().positive().safeParse(answer.data).success)
    throw new AuditNotWrittenError("unexpected_answer");
}
