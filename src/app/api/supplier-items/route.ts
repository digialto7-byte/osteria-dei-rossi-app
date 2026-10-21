import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { definedOnly, listRows, parseActiveFilter } from "@/server/master/resource";
import {
  createSupplierItem,
  createSupplierItemBody,
  listFilters,
  supplierItemSpec,
} from "@/server/master/supplier-items";

// Supplier items carry prices from M5 on, so they are owner/admin only (plan §3.11.2).
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) => {
  const url = new URL(request.url);
  const filters = listFilters.safeParse(Object.fromEntries(url.searchParams));
  if (!filters.success) throw new ApiError(400, "invalid_request", "Filtri non validi.");
  const eq = definedOnly({
    supplier_id: filters.data.supplierId,
    ingredient_id: filters.data.ingredientId,
  }) as Record<string, string>;
  return Response.json({
    items: await listRows(supabase, supplierItemSpec, parseActiveFilter(url), eq),
  });
});

export const POST = withApi(
  { roles: ["owner", "admin"], body: createSupplierItemBody },
  async ({ supabase, body }) =>
    Response.json({ item: await createSupplierItem(supabase, body) }, { status: 201 }),
);
