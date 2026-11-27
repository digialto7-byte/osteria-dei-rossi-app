import { parseArgs } from "node:util";
import { z } from "zod";
import { findAuthId, LookupError } from "./platform-admin";
import { AUDIT_NOT_WRITTEN, AuditNotWrittenError, recordScriptRun } from "./platform-audit";

// SP3 PR 1 (lead decision 2026-11-27): scripts/add-owner.ts --tenant <uuid> --email <address> --name <display name>. Adds an e-mail owner login to an EXISTING
// tenant with the secret key, so a venue's manager can be made owner later. The login is created (e-mail, confirmed, no password: the owner signs in with an
// e-mail code) or, when an auth user with that address exists, reused only if it is a member of no tenant at all. Then the owner row is inserted, and only then
// one platform audit row script.add_owner is written through the shared helper (scripts/lib/platform-audit.ts). The database guards still apply (a platform
// staff login cannot become an owner: platform_staff_member_role). The script prints only 8-character id prefixes, never a full id and never the address; errors
// are codes. Exit codes: 0 done, 1 refused or failed, 2 wrong arguments (nothing was called).

const USAGE = "Uso / Usage: add-owner.ts --tenant <uuid> --email <address> --name <display name>";

const argsSchema = z.object({
  tenant: z
    .uuid()
    .refine((value) => value === value.toLowerCase(), { message: "uuid must be lowercase" }),
  email: z.email(),
  name: z.string().trim().min(1).max(100),
});
const MEMBER_ID = z
  .uuid()
  .refine((value) => value === value.toLowerCase(), { message: "uuid must be lowercase" });

type DbError = { message: string; code?: string } | null;
type DbAnswer = PromiseLike<{ data: unknown; error: DbError }>;

/** The parts of the secret-key Supabase client this script uses. */
export interface AddOwnerClient {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): DbAnswer };
    insert(row: Record<string, unknown>): {
      select(columns: string): { single(): DbAnswer };
    };
  };
  rpc(fn: string, args: Record<string, unknown>): DbAnswer;
  auth: {
    admin: {
      listUsers(params: { page: number; perPage: number }): PromiseLike<{
        data: { users: { id: string; email?: string | null }[] } | null;
        error: DbError;
      }>;
      createUser(attributes: { email: string; email_confirm: boolean }): PromiseLike<{
        data: { user: { id: string } | null };
        error: DbError;
      }>;
      deleteUser(id: string): PromiseLike<{ error: DbError }>;
    };
  };
}

export interface AddOwnerIo {
  /** Creates the admin client. Called only after the arguments are valid. */
  admin: () => AddOwnerClient;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** A fixed error name of ours may be shown; anything else only as its code. Never a raw message (it can hold an address). */
function codeOf(error: { message: string; code?: string }): string {
  return /^[a-z_]{1,60}$/.test(error.message) ? error.message : (error.code ?? "unknown_error");
}

const prefix = (id: string) => id.slice(0, 8);

class Refused extends Error {}

/** Reads the three arguments, each exactly once. Nothing of a refused argument is echoed (it could be an address or a name). */
function parseAddOwnerArgs(argv: string[]): z.infer<typeof argsSchema> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      tenant: { type: "string", multiple: true },
      email: { type: "string", multiple: true },
      name: { type: "string", multiple: true },
    },
  });
  const once = (list: string[] | undefined) => (list?.length === 1 ? list[0] : undefined);
  return argsSchema.parse({
    tenant: once(values.tenant),
    email: once(values.email),
    name: once(values.name),
  });
}

/** The auth user for the address: an existing one that is a member nowhere, or a new confirmed e-mail user without a password. */
async function ownerLogin(
  admin: AddOwnerClient,
  email: string,
): Promise<{ authId: string; created: boolean }> {
  let existing: string | null;
  try {
    existing = await findAuthId(admin, email);
  } catch (error) {
    throw new Refused(
      `Could not look the login up: ${error instanceof LookupError ? error.message : "unknown_error"}`,
    );
  }
  if (existing !== null) {
    const { data, error } = await admin
      .from("app_user")
      .select("tenant_id")
      .eq("auth_id", existing);
    if (error) throw new Refused(`Could not read the login's memberships: ${codeOf(error)}`);
    if (!Array.isArray(data))
      throw new Refused("Could not read the login's memberships: unexpected_answer");
    if (data.length > 0)
      throw new Refused("Refused: auth_user_is_member (the login already belongs to a venue)");
    return { authId: existing, created: false };
  }
  const made = await admin.auth.admin.createUser({ email, email_confirm: true });
  const authId = made.data.user?.id;
  if (made.error || !authId)
    throw new Refused(`Could not create the login: ${made.error ? codeOf(made.error) : "no_user"}`);
  return { authId, created: true };
}

/** Runs the script. Returns the exit code. */
export async function runAddOwner(
  argv: string[],
  _env: Record<string, string | undefined>,
  io: AddOwnerIo,
): Promise<number> {
  let args: z.infer<typeof argsSchema>;
  try {
    args = parseAddOwnerArgs(argv);
  } catch {
    io.err(`Argomenti non validi / Invalid arguments. ${USAGE}`);
    return 2;
  }

  const admin = io.admin();
  try {
    const tenant = await admin.from("tenant").select("id").eq("id", args.tenant);
    if (tenant.error) throw new Refused(`Could not read the tenant: ${codeOf(tenant.error)}`);
    if (!Array.isArray(tenant.data) || tenant.data.length !== 1)
      throw new Refused("Refused: tenant_not_found");

    const login = await ownerLogin(admin, args.email);

    const row = await admin
      .from("app_user")
      .insert({
        tenant_id: args.tenant,
        auth_id: login.authId,
        role: "owner",
        display_name: args.name,
      })
      .select("id")
      .single();
    if (row.error) {
      if (!login.created)
        throw new Refused(
          `Could not add the owner (no auth user was touched): ${codeOf(row.error)}`,
        );
      const cleanup = await admin.auth.admin.deleteUser(login.authId);
      const outcome = cleanup.error
        ? `auth user ${prefix(login.authId)} could NOT be removed (${codeOf(cleanup.error)}); delete it by hand`
        : "auth user removed";
      throw new Refused(`Could not add the owner (${outcome}): ${codeOf(row.error)}`);
    }
    const member = MEMBER_ID.safeParse((row.data as { id?: unknown } | null)?.id);
    // The row may exist now, so nothing is removed: the operator checks the tenant's members.
    if (!member.success) throw new Refused("Could not add the owner: unexpected_answer");

    // The platform audit row is written after the owner row exists and only then. If it cannot be written the run fails: the owner WAS added.
    try {
      await recordScriptRun(admin, "script.add_owner", args.tenant, {
        tenantId: args.tenant,
        appUserId: member.data,
        authId: login.authId,
        outcome: login.created ? "created" : "reused",
      });
    } catch (error) {
      const reason = error instanceof AuditNotWrittenError ? error.message : AUDIT_NOT_WRITTEN;
      throw new Refused(
        `${reason}: the owner WAS added; its member id starts with ${prefix(member.data)}`,
      );
    }

    io.out(
      JSON.stringify({
        tenantId: prefix(args.tenant),
        authId: prefix(login.authId),
        appUserId: prefix(member.data),
        created: login.created,
      }),
    );
    return 0;
  } catch (error) {
    io.err(
      error instanceof Refused ? error.message : "Operazione rifiutata / Refused: unreachable",
    );
    return 1;
  }
}
