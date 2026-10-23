import { withApi } from "@/lib/api/with-api";
import { listDevices } from "@/server/staff-auth/devices";

export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase }) =>
  Response.json(await listDevices(supabase)),
);
