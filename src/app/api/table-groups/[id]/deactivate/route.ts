import { withApi } from "@/lib/api/with-api";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { emptyBody, idParams } from "@/server/reservations/schemas";
import { deactivateTableGroup } from "@/server/reservations/tables";

export const POST = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: emptyBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, params }) => Response.json(await deactivateTableGroup(supabase, params.id)),
);
