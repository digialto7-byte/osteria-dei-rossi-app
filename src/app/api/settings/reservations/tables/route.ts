import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { noQuery, tableBookingBody } from "@/server/reservations/schemas";
import { readTableBooking, saveTableBooking } from "@/server/reservations/tables";

const MANAGERS = ["owner", "admin"] as const;

export const GET = withApi({ roles: MANAGERS }, async ({ request, supabase }) => {
  parseQuery(noQuery, new URL(request.url));
  return Response.json(await readTableBooking(supabase));
});

export const PUT = withApi(
  { roles: MANAGERS, body: tableBookingBody, maxBodyBytes: MAX_RESERVATION_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await saveTableBooking(supabase, body)),
);
