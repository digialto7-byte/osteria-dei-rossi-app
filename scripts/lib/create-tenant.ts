import { parseArgs } from "node:util";
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
  ownerEmail: z.email(),
  ownerName: z.string().trim().min(1).max(100),
});

const FLAG_FOR: Record<keyof CreateTenantInput, string> = {
  name: "--name",
  vatNumber: "--vat",
  ownerEmail: "--owner-email",
  ownerName: "--owner-name",
};

export function parseCreateTenantArgs(argv: string[]): CreateTenantInput {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      name: { type: "string" },
      vat: { type: "string" },
      "owner-email": { type: "string" },
      "owner-name": { type: "string" },
    },
  });
  const parsed = inputSchema.safeParse({
    name: values.name,
    vatNumber: values.vat,
    ownerEmail: values["owner-email"],
    ownerName: values["owner-name"],
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${FLAG_FOR[issue.path[0] as keyof CreateTenantInput]}: ${issue.message}`,
    );
    throw new Error(`Invalid arguments. ${problems.join("; ")}`);
  }
  return parsed.data;
}

/** The parts of the secret-key Supabase client this script uses. */
export interface AdminClient {
  auth: {
    admin: {
      createUser(attributes: { email: string; email_confirm: boolean }): Promise<{
        data: { user: { id: string } | null };
        error: { message: string } | null;
      }>;
      deleteUser(id: string): Promise<{ error: { message: string } | null }>;
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

/**
 * Creates the owner's auth user (confirmed, so the first magic link signs them in), then the
 * tenant and its owner app_user in one transaction. Returns the tenant id.
 */
export async function createTenant(admin: AdminClient, input: CreateTenantInput): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email: input.ownerEmail,
    email_confirm: true,
  });
  const userId = created.data.user?.id;
  if (created.error || !userId) {
    throw new Error(
      `Could not create the owner's auth user: ${created.error?.message ?? "no user"}`,
    );
  }

  const { data, error } = await admin.rpc("create_tenant_with_owner", {
    tenant_name: input.name,
    tenant_vat_number: input.vatNumber,
    owner_auth_id: userId,
    owner_display_name: input.ownerName,
  });
  if (error) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`Could not create the tenant (owner auth user removed): ${error.message}`);
  }
  return z.uuid().parse(data);
}
