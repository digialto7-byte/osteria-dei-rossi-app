import { withApi } from "@/lib/api/with-api";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { tableGroupBody } from "@/server/reservations/schemas";
import { createTableGroup } from "@/server/reservations/tables";

export const POST = withApi(
  { roles: ["owner", "admin"], body: tableGroupBody, maxBodyBytes: MAX_RESERVATION_BODY_BYTES },
  async ({ supabase, body }) =>
    Response.json(await createTableGroup(supabase, body), { status: 201 }),
);
