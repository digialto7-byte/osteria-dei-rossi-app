import { parseArgs } from "node:util";
import { z } from "zod";

// P2-1 A13 (docs/plans/2026-11-12-p2-1-totp.md section 3.7; founder decision Q-T1 = V1 of 2026-11-12): the two founder scripts of the second factor.
//   scripts/set-mfa-enforcement.ts --tenant <uuid> --mode off|enrolled|required --actor <admin app_user uuid>
//   scripts/mfa-reset.ts           --user <app_user uuid> --actor <admin app_user uuid>
// They run with the secret key in the founder's environment. The entry scripts create the admin client through src/lib/supabase/admin.ts, the one place that reads
// SUPABASE_SECRET_KEY; this module never reads the environment and never prints a key, an id of a factor or an answer it does not understand.
// Exit codes: 0 done, 1 refused or failed, 2 wrong arguments (nothing was called).

const UUID = z.uuid();
const MODES = ["off", "enrolled", "required"] as const;

class UsageError extends Error {}

/** The parts of the secret-key Supabase client these scripts use. */
export interface MfaAdminClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string; details?: string | null } | null;
  }>;
  auth: {
    admin: {
      mfa: {
        listFactors(params: { userId: string }): PromiseLike<{
          data: { factors: { id: string }[] } | null;
          error: { message: string; code?: string } | null;
        }>;
        deleteFactor(params: { id: string; userId: string }): PromiseLike<{
          data: unknown;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
  };
}

export interface ScriptIo {
  /** Creates the admin client. Called only after the arguments are valid. */
  admin: () => MfaAdminClient;
  out: (line: string) => void;
  err: (line: string) => void;
}

function parse<T extends Record<string, z.ZodType>>(
  argv: string[],
  names: (keyof T & string)[],
  shape: T,
): { [K in keyof T]: z.infer<T[K]> } {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: Object.fromEntries(names.map((n) => [n, { type: "string" as const }])),
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "invalid arguments");
  }
  const parsed = z.strictObject(shape).safeParse(values);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `--${String(issue.path[0])}: ${issue.message}`,
    );
    throw new UsageError(problems.join("; "));
  }
  return parsed.data as { [K in keyof T]: z.infer<T[K]> };
}

/** A fixed error name (a Postgres exception of ours) may be shown; anything else is shown as its code only. */
function safeName(error: { message: string; code?: string }): string {
  return /^[a-z_]{1,60}$/.test(error.message) ? error.message : (error.code ?? "unknown_error");
}

function usage(io: ScriptIo, line: string, hint: string): number {
  io.err(`Argomenti non validi / Invalid arguments: ${line}`);
  io.err(hint);
  return 2;
}

const ENFORCEMENT_HINT =
  "Uso / Usage: set-mfa-enforcement.ts --tenant <uuid> --mode off|enrolled|required --actor <admin app_user uuid>";
const RESET_HINT = "Uso / Usage: mfa-reset.ts --user <app_user uuid> --actor <admin app_user uuid>";

/** Sets the enforcement mode of a tenant (T-3). `required` is refused while an active admin has no verified factor, so nobody is locked out. */
export async function runSetMfaEnforcement(argv: string[], io: ScriptIo): Promise<number> {
  let args: { tenant: string; mode: (typeof MODES)[number]; actor: string };
  try {
    args = parse(argv, ["tenant", "mode", "actor"], {
      tenant: UUID,
      mode: z.enum(MODES),
      actor: UUID,
    });
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return usage(io, error.message, ENFORCEMENT_HINT);
  }
  const { data, error } = await io
    .admin()
    .rpc("set_mfa_enforcement", { p_tenant: args.tenant, p_mode: args.mode, p_actor: args.actor });
  if (error) {
    if (error.message === "admins_not_enrolled") {
      const count = z.object({ count: z.number() }).safeParse(safeJson(error.details));
      const n = count.success ? String(count.data.count) : "alcuni / some";
      io.err(
        `Impossibile attivare "required": ${n} admin non hanno ancora attivato la verifica in due passaggi. / ` +
          `Cannot set "required": ${n} admin(s) have not turned on the second factor yet.`,
      );
    } else {
      io.err(`Operazione rifiutata / Refused: ${safeName(error)}`);
    }
    return 1;
  }
  const result = z.strictObject({ changed: z.boolean(), mode: z.enum(MODES) }).safeParse(data);
  if (!result.success) {
    io.err("Risposta inattesa dal database / Unexpected answer from the database.");
    return 1;
  }
  io.out(JSON.stringify({ changed: result.data.changed, mode: result.data.mode }));
  return 0;
}

function safeJson(text: string | null | undefined): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The break-glass reset (D2): begin writes the audit row app_user.mfa_reset first (T-8), which also deletes the target's Auth sessions (deleting a factor does not sign anyone out), then every factor of the account is
 * deleted through the Supabase admin API. A failure after begin is recorded by the failed twin. Prints the number of removed factors only.
 */
export async function runMfaReset(argv: string[], io: ScriptIo): Promise<number> {
  let args: { user: string; actor: string };
  try {
    args = parse(argv, ["user", "actor"], { user: UUID, actor: UUID });
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return usage(io, error.message, RESET_HINT);
  }
  const admin = io.admin();
  const began = await admin.rpc("mfa_reset_service_begin", {
    p_user: args.user,
    p_actor: args.actor,
  });
  const authId = z.object({ authId: z.uuid() }).safeParse(began.data);
  if (began.error || !authId.success) {
    io.err(
      `Operazione rifiutata / Refused: ${began.error ? safeName(began.error) : "unexpected_answer"}`,
    );
    return 1;
  }
  const userId = authId.data.authId;
  let removed = 0;
  const fail = async (step: string, code: string): Promise<number> => {
    io.err(
      `Reset non completato (${step}: ${code}); rimossi ${removed}. / Reset not completed (${step}: ${code}); removed ${removed}.`,
    );
    const recorded = await admin.rpc("mfa_reset_service_failed", {
      p_user: args.user,
      p_actor: args.actor,
    });
    if (recorded.error)
      io.err(
        `Registrazione del fallimento non riuscita / Could not record the failure: ${safeName(recorded.error)}`,
      );
    return 1;
  };
  const listed = await admin.auth.admin.mfa.listFactors({ userId });
  if (listed.error || !listed.data) return fail("list", listed.error?.code ?? "unknown_error");
  for (const factor of listed.data.factors) {
    const deleted = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleted.error) return fail("delete", deleted.error.code ?? "unknown_error");
    removed += 1;
  }
  io.out(JSON.stringify({ removed }));
  return 0;
}
