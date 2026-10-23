import { withApi } from "@/lib/api/with-api";
import { readPinEnv } from "@/lib/env";
import { idParams } from "@/server/master/schemas";
import { pinBody } from "@/server/staff-auth/schemas";
import { setStaffPin } from "@/server/staff-auth/staff";

export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: pinBody },
  async ({ supabase, params, body }) => {
    await setStaffPin(supabase, params.id, body.pin, readPinEnv().pinPepper);
    return new Response(null, { status: 204 });
  },
);
