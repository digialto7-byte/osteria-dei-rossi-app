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

/** The script takes no arguments. An argument is refused without being echoed (it could be a name or an address). */
export function assertNoArguments(argv: string[]): void {
  if (argv.length > 0)
    throw new Error(
      `This script takes no arguments: set ${Object.values(ENV_FOR).join(", ")} in the environment.`,
    );
}

/** How an id is shown: in full on a developer's machine; under GitHub Actions masked first and cut to its first 8 characters (the run log of this repository is public). */
export interface IdDisplay {
  reveal(id: string): string;
}

/** Full ids always: for callers on a throwaway local stack (the SP0 spike), where no id is a secret. */
export const FULL_IDS: IdDisplay = { reveal: (id) => id };

/**
 * `CREATE_TENANT_FULL_ID=1` keeps the full id under Actions for one caller: the backup self-test, whose throwaway local stack has no secret ids and which needs the
 * id on stdout. The platform-ops workflow never sets it.
 */
export function createIdDisplay(
  env: Record<string, string | undefined>,
  write: (line: string) => void,
): IdDisplay {
  const masked = env.GITHUB_ACTIONS === "true" && env.CREATE_TENANT_FULL_ID !== "1";
  if (!masked) return { reveal: (id) => id };
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
): Promise<string> {
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
  return z.uuid().parse(data);
}
