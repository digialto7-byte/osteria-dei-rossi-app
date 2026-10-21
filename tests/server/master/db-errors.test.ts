import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapDbError } from "@/server/master/db-errors";

const unique = (constraint: string) => ({
  code: "23505",
  message: `duplicate key value violates unique constraint "${constraint}"`,
});
const check = (constraint: string) => ({
  code: "23514",
  message: `new row for relation "x" violates check constraint "${constraint}"`,
});

function mapped(error: { code?: string; message: string }) {
  const result = mapDbError(error);
  return result instanceof ApiError ? { status: result.status, code: result.code } : "rethrown";
}

describe("mapDbError", () => {
  it.each([
    [unique("supplier_tenant_vat_uq"), 409, "duplicate_vat_number"],
    [unique("location_name_uq"), 409, "duplicate_name"],
    [unique("ingredient_name_uq"), 409, "duplicate_name"],
    [unique("supplier_item_code_uq"), 409, "duplicate_supplier_code"],
    [unique("supplier_item_preferred_uq"), 409, "preferred_conflict"],
    [unique("something_else"), 409, "conflict"],
    [check("supplier_vat_number_ck"), 422, "invalid_vat_number"],
    [check("supplier_item_pack_qty_check"), 422, "invalid_pack"],
    [check("supplier_item_pack_count_check"), 422, "invalid_pack"],
    [check("location_name_check"), 422, "invalid_request"],
    [{ code: "23503", message: "violates foreign key constraint" }, 422, "invalid_reference"],
    [{ code: "22023", message: "incompatible_units" }, 422, "incompatible_units"],
    [{ code: "42501", message: "permission denied for table supplier" }, 403, "forbidden"],
    [{ code: "P0002", message: "not_found" }, 404, "not_found"],
  ])("%j → %i %s", (error, status, code) => {
    expect(mapped(error)).toEqual({ status, code });
  });

  it("leaves anything else to the 500 handler, without the database message", () => {
    const result = mapDbError({ code: "XX000", message: "internal detail: secret table name" });
    expect(result).not.toBeInstanceOf(ApiError);
    expect(String(result)).not.toContain("secret table name");
    expect(String(result)).toContain("XX000");
  });

  it("never echoes the database message to the client", () => {
    const result = mapDbError(unique("supplier_tenant_vat_uq")) as ApiError;
    expect(result.message).not.toContain("supplier_tenant_vat_uq");
  });
});
