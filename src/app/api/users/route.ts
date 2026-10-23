import { withApi } from "@/lib/api/with-api";
import { readPinEnv } from "@/lib/env";
import { createUserBody } from "@/server/staff-auth/schemas";
import { createStaff, listStaff } from "@/server/staff-auth/staff";

export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase }) =>
  Response.json({ staff: await listStaff(supabase) }),
);

export const POST = withApi(
  { roles: ["owner", "admin"], body: createUserBody },
  async ({ supabase, body }) =>
    Response.json(
      { user: await createStaff(supabase, body, readPinEnv().pinPepper) },
      { status: 201 },
    ),
);
