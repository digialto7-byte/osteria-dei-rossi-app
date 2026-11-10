import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { slotsQuery, slugParams } from "@/server/reservations/public/schemas";
import { readPublicSlots } from "@/server/reservations/public/slots";

export const GET = withApi({ public: true, params: slugParams }, async ({ request, params }) =>
  Response.json(
    await readPublicSlots(params.slug, parseQuery(slotsQuery, new URL(request.url)), Date.now()),
  ),
);
