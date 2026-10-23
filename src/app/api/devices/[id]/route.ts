import { withApi } from "@/lib/api/with-api";
import { revokeDevice } from "@/server/staff-auth/devices";
import { idParams } from "@/server/master/schemas";

// DELETE is a state change (revocation), never a row delete; repeating it is harmless.
export const DELETE = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) =>
    Response.json({ device: await revokeDevice(supabase, params.id) }),
);
