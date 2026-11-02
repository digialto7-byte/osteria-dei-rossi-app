import { withApi } from "@/lib/api/with-api";
import { changePassword, passwordStatus } from "@/server/auth/password-change";
import { passwordChangeBody } from "@/server/auth/schemas";

const OWNER_ADMIN = ["owner", "admin"] as const;

export const GET = withApi({ roles: OWNER_ADMIN }, async ({ supabase }) =>
  Response.json(await passwordStatus(supabase)),
);

export const POST = withApi(
  { roles: OWNER_ADMIN, body: passwordChangeBody },
  async ({ supabase, body }) => Response.json(await changePassword(supabase, body)),
);
