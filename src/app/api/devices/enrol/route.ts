import { withApi } from "@/lib/api/with-api";
import { readPinEnv } from "@/lib/env";
import { serializeDeviceCookie } from "@/server/staff-auth/device-cookie";
import { clientIp, enrolDevice } from "@/server/staff-auth/enrolment";
import { enrolBody } from "@/server/staff-auth/schemas";

// Public: a new device has no session. The single-use code and the per-IP limit decide (ADR-010).
export const POST = withApi({ public: true, body: enrolBody }, async ({ request, body }) => {
  const { label, token } = await enrolDevice({
    code: body.code,
    ip: clientIp(request),
    pepper: readPinEnv().pinPepper,
  });
  const response = Response.json({ device: { label } }, { status: 201 });
  response.headers.append("set-cookie", serializeDeviceCookie(token));
  return response;
});
