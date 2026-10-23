import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/master/schemas";
import { unlockDevice } from "@/server/staff-auth/devices";

export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: z.strictObject({}) },
  async ({ supabase, params }) =>
    Response.json({ device: await unlockDevice(supabase, params.id) }),
);
