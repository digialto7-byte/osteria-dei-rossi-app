import { withApi } from "@/lib/api/with-api";
import { locationPatch, locationSpec, updateLocationBody } from "@/server/master/locations";
import { getRow, updateRow } from "@/server/master/resource";
import { idParams } from "@/server/master/schemas";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, params }) =>
    Response.json({ location: await getRow(supabase, locationSpec, params.id) }),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], params: idParams, body: updateLocationBody },
  async ({ supabase, params, body }) =>
    Response.json({
      location: await updateRow(supabase, locationSpec, params.id, locationPatch(body)),
    }),
);
