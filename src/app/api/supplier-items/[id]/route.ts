import { withApi } from "@/lib/api/with-api";
import { getRow } from "@/server/master/resource";
import { idParams } from "@/server/master/schemas";
import {
  supplierItemSpec,
  updateSupplierItem,
  updateSupplierItemBody,
} from "@/server/master/supplier-items";

export const GET = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) =>
    Response.json({ item: await getRow(supabase, supplierItemSpec, params.id) }),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], params: idParams, body: updateSupplierItemBody },
  async ({ supabase, params, body }) =>
    Response.json({ item: await updateSupplierItem(supabase, params.id, body) }),
);
