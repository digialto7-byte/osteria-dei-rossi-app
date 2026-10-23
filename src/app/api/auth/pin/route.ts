import { withApi } from "@/lib/api/with-api";
import { readPinEnv } from "@/lib/env";
import { readDeviceToken } from "@/server/staff-auth/device-cookie";
import { pinLogin } from "@/server/staff-auth/pin-login";
import { pinLoginBody } from "@/server/staff-auth/schemas";

// Public: the person is not signed in yet. The device cookie and the database gate decide (ADR-010).
export const POST = withApi(
  { public: true, body: pinLoginBody },
  async ({ request, body, supabase }) => {
    const result = await pinLogin({
      supabase,
      deviceToken: readDeviceToken(request),
      userId: body.userId,
      pin: body.pin,
      pepper: readPinEnv().pinPepper,
    });
    return Response.json(result);
  },
);
