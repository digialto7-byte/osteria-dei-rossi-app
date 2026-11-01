import { withApi } from "@/lib/api/with-api";
import { clearDeviceCookie, readDeviceToken } from "@/server/staff-auth/device-cookie";
import { deviceStaffList } from "@/server/staff-auth/privileged";
import { sha256Hex } from "@/server/staff-auth/tokens";

// Public: tells the PIN screen whether this browser is an enrolled device and whom to list.
export const GET = withApi({ public: true }, async ({ request }) => {
  const token = readDeviceToken(request);
  if (!token) return Response.json({ enrolled: false });

  const result = await deviceStaffList(sha256Hex(token));
  if (result.status !== "ok") {
    // "revoked" is told only for a token the server knows; an unknown or forged one gets the plain answer.
    const response = Response.json(
      result.status === "revoked" ? { enrolled: false, revoked: true } : { enrolled: false },
    );
    response.headers.append("set-cookie", clearDeviceCookie());
    return response;
  }
  return Response.json({
    enrolled: true,
    label: result.label,
    locked: result.locked,
    staff: result.staff.map(({ id, displayName, role }) => ({ id, displayName, role })),
  });
});
