import { withApi } from "@/lib/api/with-api";
import { getRow, updateRow } from "@/server/master/resource";
import { idParams } from "@/server/master/schemas";
import { supplierColumns, supplierSpec, updateSupplierBody } from "@/server/master/suppliers";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, params }) =>
    Response.json({ supplier: await getRow(supabase, supplierSpec, params.id) }),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], params: idParams, body: updateSupplierBody },
  async ({ supabase, params, body }) =>
    Response.json({
      supplier: await updateRow(supabase, supplierSpec, params.id, supplierColumns(body)),
    }),
);
