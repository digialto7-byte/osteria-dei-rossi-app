import { withApi } from "@/lib/api/with-api";
import { createLocationBody, locationSpec } from "@/server/master/locations";
import { insertRow, listRows, parseActiveFilter } from "@/server/master/resource";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json({
    locations: await listRows(supabase, locationSpec, parseActiveFilter(new URL(request.url))),
  }),
);

export const POST = withApi(
  { roles: ["owner", "admin"], body: createLocationBody },
  async ({ supabase, body }) =>
    Response.json(
      { location: await insertRow(supabase, locationSpec, { name: body.name }) },
      { status: 201 },
    ),
);
