import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/master/schemas";
import { patchUserBody } from "@/server/staff-auth/schemas";
import { updateStaff } from "@/server/staff-auth/staff";

export const PATCH = withApi(
  { roles: ["owner", "admin"], params: idParams, body: patchUserBody },
  async ({ supabase, params, body }) =>
    Response.json({ user: await updateStaff(supabase, params.id, body) }),
);
