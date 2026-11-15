import { parseArgs } from "node:util";
import { z } from "zod";
import { createIdDisplay } from "./create-tenant";

// SP3 step 7 (docs/plans/2026-11-15-sp3-console.md section 3.9.1): scripts/platform-admin.ts bootstrap [--auth-id <uuid>].
// Runs only as the `bootstrap` job of the platform-ops workflow, with the secret key. Without --auth-id the platform admin account is found by the address in the environment
// secret PLATFORM_ADMIN_EMAIL (never an argument, never an input): the Auth admin API's user list is read page by page and compared in memory. The address is never printed,
// logged or put in an error. The script makes one writing call, public.platform_bootstrap_admin, which writes the staff row and the audit row itself (AT8). Errors are codes only.
// Exit codes: 0 done, 1 refused or failed, 2 wrong arguments (nothing was called).

const UUID = z.uuid();
const PAGE_SIZE = 200;
/** A hard stop for the lookup: 500 pages of 200 is 100 000 accounts, far more than this product will hold; past it the run fails with a code instead of looping. */
const MAX_PAGES = 500;
const USAGE = "Uso / Usage: platform-admin.ts bootstrap [--auth-id <uuid>]";
const NEXT_LINE = "next: sign in on the console host and set up the code";

/** The parts of the secret-key Supabase client this script uses. */
export interface PlatformAdminClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  auth: {
    admin: {
      listUsers(params: { page: number; perPage: number }): PromiseLike<{
        data: { users: { id: string; email?: string | null }[] } | null;
        error: { message: string; code?: string } | null;
      }>;
    };
  };
}

export interface PlatformAdminIo {
  /** Creates the admin client. Called only after the arguments and the environment are valid. */
  admin: () => PlatformAdminClient;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** A fixed error name of ours may be shown; anything else only as its code. Never a raw message (it can hold an address). */
function codeOf(error: { message: string; code?: string }): string {
  return /^[a-z_]{1,60}$/.test(error.message) ? error.message : (error.code ?? "unknown_error");
}

class LookupError extends Error {}

/** Finds the auth user of an address: the user list page by page, compared in memory, stopping at the first match or at the first short page. */
async function findAuthId(admin: PlatformAdminClient, address: string): Promise<string | null> {
  const wanted = address.trim().toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error || !data) throw new LookupError(error ? codeOf(error) : "unknown_error");
    const found = data.users.find((u) => (u.email ?? "").trim().toLowerCase() === wanted);
    if (found) return found.id;
    if (data.users.length < PAGE_SIZE) return null;
  }
  throw new LookupError("auth_user_lookup_incomplete");
}

/** Runs the script. Returns the exit code. */
export async function runPlatformAdmin(
  argv: string[],
  env: Record<string, string | undefined>,
  io: PlatformAdminIo,
): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "bootstrap") {
    io.err(USAGE);
    return 2;
  }
  let authId: string | undefined;
  try {
    const { values } = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: false,
      options: { "auth-id": { type: "string" } },
    });
    if (values["auth-id"] !== undefined) {
      const parsed = UUID.safeParse(values["auth-id"]);
      if (
        !parsed.success ||
        parsed.data !== values["auth-id"] ||
        parsed.data !== parsed.data.toLowerCase()
      )
        throw new Error("invalid");
      authId = parsed.data;
    }
  } catch {
    // Nothing of the arguments is echoed: they could hold an address.
    io.err(`Argomenti non validi / Invalid arguments. ${USAGE}`);
    return 2;
  }
  const address = (env.PLATFORM_ADMIN_EMAIL ?? "").trim();
  if (authId === undefined && address === "") {
    io.err("Missing environment variable: PLATFORM_ADMIN_EMAIL (or pass --auth-id).");
    return 1;
  }

  const admin = io.admin();
  if (authId === undefined) {
    try {
      const found = await findAuthId(admin, address);
      if (found === null) {
        io.err("no auth user for the given address");
        return 1;
      }
      authId = found;
    } catch (error) {
      io.err(
        `Could not look the account up: ${error instanceof LookupError ? error.message : "unknown_error"}`,
      );
      return 1;
    }
  }

  const { data, error } = await admin.rpc("platform_bootstrap_admin", { p_auth: authId });
  if (error) {
    io.err(`Operazione rifiutata / Refused: ${codeOf(error)}`);
    return 1;
  }
  const answer = z.strictObject({ authId: UUID, hasVerifiedFactor: z.boolean() }).safeParse(data);
  if (!answer.success) {
    io.err("Risposta inattesa dal database / Unexpected answer from the database.");
    return 1;
  }
  // Under GitHub Actions the id is masked first and only its first 8 characters are shown (the run log of this repository is public).
  const display = createIdDisplay(env, io.out);
  io.out(
    JSON.stringify({
      authId: display.reveal(answer.data.authId),
      hasVerifiedFactor: answer.data.hasVerifiedFactor,
    }),
  );
  if (!answer.data.hasVerifiedFactor) io.out(NEXT_LINE);
  return 0;
}
