import { withApi } from "@/lib/api/with-api";
import { isPinPepperConfigured } from "@/lib/env";
import { listDevices } from "@/server/staff-auth/devices";
import type { DeviceListReply } from "@/server/staff-auth/types";

export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase }) => {
  const reply: DeviceListReply = {
    ...(await listDevices(supabase)),
    pinLoginReady: isPinPepperConfigured(),
  };
  return Response.json(reply);
});
