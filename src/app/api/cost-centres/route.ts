import { withApi } from "@/lib/api/with-api";
import { costCentreSpec, createCostCentreBody } from "@/server/master/cost-centres";
import { insertRow, listRows, parseActiveFilter } from "@/server/master/resource";

export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) =>
  Response.json({
    costCentres: await listRows(supabase, costCentreSpec, parseActiveFilter(new URL(request.url))),
  }),
);

export const POST = withApi(
  { roles: ["owner", "admin"], body: createCostCentreBody },
  async ({ supabase, body }) =>
    Response.json(
      { costCentre: await insertRow(supabase, costCentreSpec, { name: body.name }) },
      { status: 201 },
    ),
);
