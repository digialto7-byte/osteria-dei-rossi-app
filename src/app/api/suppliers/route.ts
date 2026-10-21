import { withApi } from "@/lib/api/with-api";
import { insertRow, listRows, parseActiveFilter } from "@/server/master/resource";
import { createSupplierBody, supplierColumns, supplierSpec } from "@/server/master/suppliers";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json({
    suppliers: await listRows(supabase, supplierSpec, parseActiveFilter(new URL(request.url))),
  }),
);

export const POST = withApi(
  { roles: ["owner", "admin"], body: createSupplierBody },
  async ({ supabase, body }) =>
    Response.json(
      { supplier: await insertRow(supabase, supplierSpec, supplierColumns(body)) },
      { status: 201 },
    ),
);
