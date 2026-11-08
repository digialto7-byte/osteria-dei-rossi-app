import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { noQuery, reservationSettingsBody } from "@/server/reservations/schemas";
import { readReservationSettings, saveReservationSettings } from "@/server/reservations/settings";

// Owner and admin only: the waiter and the chef get 403 before any RPC. The functions behind it are SECURITY DEFINER and check the role again.
const MANAGERS = ["owner", "admin"] as const;

export const GET = withApi({ roles: MANAGERS }, async ({ request, supabase }) => {
  parseQuery(noQuery, new URL(request.url));
  return Response.json(await readReservationSettings(supabase));
});

export const PATCH = withApi(
  { roles: MANAGERS, body: reservationSettingsBody, maxBodyBytes: MAX_RESERVATION_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await saveReservationSettings(supabase, body)),
);
