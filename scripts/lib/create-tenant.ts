import { closeSync, constants, fchmodSync, openSync, unlinkSync, writeSync } from "node:fs";
import { z } from "zod";

export interface CreateTenantInput {
  name: string;
  vatNumber: string;
  ownerEmail: string;
  ownerName: string;
}

const inputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  vatNumber: z.string().regex(/^IT[0-9]{11}$/, "expected IT followed by 11 digits"),
  ownerEmail: z.email("not an e-mail address"),
  ownerName: z.string().trim().min(1).max(100),
});

/** The tenant and the owner arrive as environment variables (the `platform-ops` secrets), never as arguments: an argument shows in process listings and logs. */
const ENV_FOR: Record<keyof CreateTenantInput, string> = {
  name: "TENANT_NAME",
  vatNumber: "TENANT_VAT_NUMBER",
  ownerEmail: "OWNER_EMAIL",
  ownerName: "OWNER_NAME",
};

/**
 * Reads the four variables. Missing or blank ones are named together before anything is called; an invalid value is reported by its variable name and a fixed
 * reason, never by the value.
 */
export function readCreateTenantEnv(env: Record<string, string | undefined>): CreateTenantInput {
  const missing = (Object.keys(ENV_FOR) as (keyof CreateTenantInput)[])
    .filter((key) => (env[ENV_FOR[key]] ?? "").trim() === "")
    .map((key) => ENV_FOR[key]);
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(", ")}.`);
  const parsed = inputSchema.safeParse({
    name: env[ENV_FOR.name],
    vatNumber: env[ENV_FOR.vatNumber],
    ownerEmail: env[ENV_FOR.ownerEmail],
    ownerName: env[ENV_FOR.ownerName],
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${ENV_FOR[issue.path[0] as keyof CreateTenantInput]}: ${issue.message}`,
    );
    throw new Error(`Invalid environment. ${problems.join("; ")}`);
  }
  return parsed.data;
}

const ARGUMENT_HINT = `This script takes no arguments except --ids-out <path>: set ${Object.values(ENV_FOR).join(", ")} in the environment.`;

/** The only argument is `--ids-out <path>`. Anything else is refused without being echoed (it could be a name or an address). */
export function parseCreateTenantArgs(argv: string[]): { idsOut: string | undefined } {
  if (argv.length === 0) return { idsOut: undefined };
  const [flag, path, ...rest] = argv;
  if (flag !== "--ids-out" || path === undefined || path === "" || rest.length > 0)
    throw new Error(ARGUMENT_HINT);
  return { idsOut: path };
}

/** The two full ids a caller on a throwaway stack reads back from `--ids-out`. */
export interface CreatedIds {
  tenantId: string;
  ownerAuthId: string;
}

/**
 * Opens the ids file once, before any network call: O_CREAT | O_EXCL | O_NOFOLLOW with mode 0600, so it fails when anything (a file, a symlink) is already at the
 * path and never follows a link. The descriptor stays open and `write` writes through it, so a link put at the path afterwards is not followed either.
 * `discard` removes the file again when the creation failed; if the removal fails it says so on `report` and does not throw, so the caller's exit code
 * stays that of the original error. This is the only way a full id leaves the script under GitHub Actions: never stdout, never stderr.
 */
export function openIdsFile(path: string): {
  write(ids: CreatedIds): void;
  discard(report: (line: string) => void): void;
} {
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    const code = errnoCode(error);
    throw new Error(code === "EEXIST" ? "ids_out_exists" : `ids_out_unwritable (${code})`);
  }
  try {
    fchmodSync(fd, 0o600);
  } catch (error) {
    // Nothing has been written yet: close the descriptor and remove the empty file. A cleanup step that fails is named in the error, never dropped.
    const leftovers: string[] = [];
    try {
      closeSync(fd);
    } catch (closeError) {
      leftovers.push(`ids_out_not_closed (${errnoCode(closeError)})`);
    }
    try {
      unlinkSync(path);
    } catch (unlinkError) {
      leftovers.push(`ids_out_not_removed (${errnoCode(unlinkError)})`);
    }
    throw new Error([`ids_out_unwritable (${errnoCode(error)})`, ...leftovers].join("; "));
  }
  // Marked closed before the call, so a close that throws is never retried on a descriptor number the process may already have reused.
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    closeSync(fd);
  };
  return {
    write(ids) {
      try {
        writeSync(fd, `${JSON.stringify(ids)}\n`);
      } finally {
        close();
      }
    },
    discard(report) {
      // Two separate steps: a failed close must not keep the file (it may hold both full ids) on disk.
      try {
        close();
      } catch (error) {
        report(`ids_out_not_closed (${errnoCode(error)})`);
      }
      try {
        unlinkSync(path);
      } catch (error) {
        report(`ids_out_not_removed (${errnoCode(error)})`);
      }
    },
  };
}

/** The errno code of a file-system error, or `unknown_error`: the only part of such an error this script prints. */
function errnoCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? "unknown_error";
}

/** How an id is shown: in full on a developer's machine; under GitHub Actions masked first and cut to its first 8 characters (the run log of this repository is public). */
export interface IdDisplay {
  reveal(id: string): string;
}

/** Full ids always: for callers on a throwaway local stack (the SP0 spike), where no id is a secret. */
export const FULL_IDS: IdDisplay = { reveal: (id) => id };

/**
 * Under GitHub Actions the id is masked first and only its first 8 characters are shown; elsewhere it is shown in full. There is no switch to turn the masking off:
 * a caller that needs a full id under Actions (the backup self-test, the e2e helper) reads it from `--ids-out`.
 */
export function createIdDisplay(
  env: Record<string, string | undefined>,
  write: (line: string) => void,
): IdDisplay {
  if (env.GITHUB_ACTIONS !== "true") return FULL_IDS;
  return {
    reveal: (id) => {
      write(`::add-mask::${id}`);
      return id.slice(0, 8);
    },
  };
}

/** A fixed error name of ours may be shown; anything else only as its code. Never a raw message (it can hold a name or an address). */
function errorCode(error: { message: string; code?: string }): string {
  return /^[a-z_]{1,60}$/.test(error.message) ? error.message : (error.code ?? "unknown_error");
}

/** The parts of the secret-key Supabase client this script uses. */
export interface AdminClient {
  auth: {
    admin: {
      createUser(attributes: { email: string; email_confirm: boolean }): Promise<{
        data: { user: { id: string } | null };
        error: { message: string; code?: string } | null;
      }>;
      deleteUser(id: string): Promise<{ error: { message: string; code?: string } | null }>;
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
}

/**
 * Creates the owner's auth user (confirmed, so the first magic link signs them in), then the
 * tenant and its owner app_user in one transaction. Returns the tenant id.
 */
export async function createTenant(
  admin: AdminClient,
  input: CreateTenantInput,
  display: IdDisplay,
): Promise<CreatedIds> {
  const created = await admin.auth.admin.createUser({
    email: input.ownerEmail,
    email_confirm: true,
  });
  const userId = created.data.user?.id;
  if (created.error || !userId) {
    throw new Error(
      `Could not create the owner's auth user: ${created.error ? errorCode(created.error) : "no_user"}`,
    );
  }

  const { data, error } = await admin.rpc("create_tenant_with_owner", {
    tenant_name: input.name,
    tenant_vat_number: input.vatNumber,
    owner_auth_id: userId,
    owner_display_name: input.ownerName,
  });
  if (error) {
    const cleanup = await admin.auth.admin.deleteUser(userId);
    const outcome = cleanup.error
      ? `owner auth user ${display.reveal(userId)} could NOT be removed (${errorCode(cleanup.error)}); delete it by hand`
      : "owner auth user removed";
    throw new Error(`Could not create the tenant (${outcome}): ${errorCode(error)}`);
  }
  return { tenantId: z.uuid().parse(data), ownerAuthId: userId };
}

/** The whole run of scripts/create-tenant.ts, with its inputs and outputs injected. Returns the exit code. */
export async function runCreateTenant(
  argv: string[],
  env: Record<string, string | undefined>,
  io: { admin: () => AdminClient; out: (line: string) => void; err: (line: string) => void },
): Promise<number> {
  let idsFile: ReturnType<typeof openIdsFile> | undefined;
  try {
    const { idsOut } = parseCreateTenantArgs(argv);
    const input = readCreateTenantEnv(env);
    if (idsOut !== undefined) idsFile = openIdsFile(idsOut);
    const display = createIdDisplay(env, io.out);
    const ids = await createTenant(io.admin(), input, display);
    if (idsFile) {
      try {
        idsFile.write(ids);
      } catch (error) {
        // The tenant exists but its ids never reached the caller: say so, with what is needed to find the full id, and fail.
        const prefix = display.reveal(ids.tenantId).slice(0, 8);
        io.err(
          `ids_out_write_failed (${errnoCode(error)}): the tenant WAS created; its id starts with ${prefix}. Full id: select id from public.tenant where id::text like '${prefix}%'; (check that exactly one row comes back)`,
        );
        idsFile.discard(io.err);
        return 1;
      }
    }
    io.out(display.reveal(ids.tenantId));
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : "unknown_error");
    idsFile?.discard(io.err);
    return 1;
  }
}
