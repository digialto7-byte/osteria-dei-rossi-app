import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapReviewError } from "@/server/invoices/review-errors";

const p0001 = (message: string) => ({ code: "P0001", message });
const constraint = (code: string, name: string) => ({
  code,
  message: `violates constraint "${name}"`,
});

function mapped(error: { code?: string; message: string }) {
  const result = mapReviewError(error);
  return result instanceof ApiError
    ? { status: result.status, code: result.code, message: result.message }
    : "rethrown";
}

describe("mapReviewError", () => {
  it.each([
    ["invoice_not_in_review", 409],
    ["line_split", 409],
    ["not_split", 409],
    ["not_flagged", 409],
    ["not_failed", 409],
    ["cost_centre_required", 422],
    ["credit_qty_exceeds_qty", 422],
    ["supplier_required", 422],
    ["pack_required", 422],
    ["non_stock_has_ingredient", 422],
    ["split_child_locked", 422],
    ["not_mapped", 422],
    ["split_sum_mismatch", 422],
    ["split_credit_conflict", 422],
    ["split_child_cannot_split", 422],
  ])("maps the procedure code %s to %i with the same code", (code, status) => {
    expect(mapped(p0001(code))).toMatchObject({ status, code });
  });

  it("not_flagged also covers a partner that is no longer a look-alike: the message says to look again", () => {
    expect(mapped(p0001("not_flagged"))).toMatchObject({
      status: 409,
      code: "not_flagged",
      message: "Il doppione indicato non è più valido: controlla di nuovo la fattura.",
    });
  });

  it.each(["invalid_request", "range_too_long"])("maps %s to 400 invalid_request", (code) => {
    expect(mapped(p0001(code))).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it.each([
    ["invoice_already_approved", 409, "La fattura è già stata approvata."],
    ["invoice_rejected", 409, "La fattura è stata rifiutata."],
    ["duplicate_invoice", 409, "La fattura risulta già registrata (doppione)."],
    ["duplicate_warning", 409, undefined],
    ["total_mismatch", 409, undefined],
    ["supplier_required", 422, undefined],
    ["invoice_date_required", 422, "Manca la data della fattura."],
    ["invoice_date_in_future", 422, "La data della fattura è nel futuro."],
    ["due_date_required", 422, undefined],
    ["lines_unmapped", 422, undefined],
    ["line_base_qty_unavailable", 422, undefined],
    ["credit_vat_rate_missing", 422, undefined],
    ["payable_negative", 422, "I resi superano il totale della fattura."],
    ["no_location", 422, "Crea prima un'ubicazione in Anagrafiche."],
    ["location_required", 422, "Scegli l'ubicazione del carico."],
    ["location_not_found", 422, "Ubicazione non valida."],
  ])("maps the approval code %s to %i with the same code", (code, status, message) => {
    const result = mapped(p0001(code));
    expect(result).toMatchObject({ status, code });
    if (message) expect(result).toMatchObject({ message });
  });

  it.each(["invoice_line_frozen", "append_only", "payable_immutable"])(
    "maps the trigger code %s to 409 conflict without database text",
    (code) => {
      const result = mapped(p0001(code));
      expect(result).toMatchObject({ status: 409, code: "conflict" });
      expect(JSON.stringify(result)).not.toMatch(/frozen|append_only|immutable/);
    },
  );

  it("maps a backstop unique violation on the ledgers to 409 conflict", () => {
    for (const name of [
      "payable_invoice_uq",
      "raw_lot_invoice_line_uq",
      "stock_movement_receipt_uq",
    ])
      expect(mapped(constraint("23505", name))).toMatchObject({ status: 409, code: "conflict" });
  });

  it("gives every approval message in Italian and none with the code or database text", () => {
    for (const code of [
      "duplicate_warning",
      "total_mismatch",
      "due_date_required",
      "lines_unmapped",
      "line_base_qty_unavailable",
      "credit_vat_rate_missing",
    ]) {
      const result = mapped(p0001(code));
      expect(result).not.toBe("rethrown");
      if (result === "rethrown") continue;
      expect(result.message).not.toContain(code);
      expect(result.message).toMatch(/[àèéìòù]|\b(la|il|le|non|del|della|di|una|righe)\b/i);
    }
  });

  it("maps the two new check constraints to the same codes as the procedures", () => {
    expect(mapped(constraint("23514", "invoice_line_credit_qty_ck"))).toMatchObject({
      status: 422,
      code: "credit_qty_exceeds_qty",
    });
    expect(mapped(constraint("23514", "invoice_line_non_stock_ck"))).toMatchObject({
      status: 422,
      code: "cost_centre_required",
    });
  });

  it("maps other checks, bad dates and foreign keys", () => {
    expect(mapped(constraint("23514", "invoice_line_unit_ck"))).toMatchObject({
      status: 422,
      code: "invalid_request",
    });
    expect(mapped(constraint("23514", "invoice_totals_ck"))).toMatchObject({
      status: 422,
      code: "invalid_request",
    });
    expect(mapped({ code: "22007", message: "invalid input syntax for type date" })).toMatchObject({
      status: 422,
      code: "invalid_request",
    });
    expect(mapped(constraint("23503", "invoice_line_ingredient_fk"))).toMatchObject({
      status: 422,
      code: "invalid_reference",
    });
  });

  it("falls back to the master-data mapping for the shared cases", () => {
    expect(mapped(constraint("23505", "supplier_tenant_vat_uq"))).toMatchObject({
      status: 409,
      code: "duplicate_vat_number",
    });
    expect(mapped({ code: "22023", message: "incompatible_units" })).toMatchObject({
      status: 422,
      code: "incompatible_units",
    });
    expect(mapped({ code: "42501", message: "insufficient_privilege" })).toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(mapped({ code: "P0002", message: "not_found" })).toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("has an Italian message without the database text", () => {
    const result = mapped(p0001("split_sum_mismatch"));
    expect(result).not.toBe("rethrown");
    if (result === "rethrown") return;
    expect(result.message).not.toMatch(/split_sum_mismatch|violates|constraint/);
    expect(result.message).toMatch(/[àèéìòù]|\b(la|il|le|non|del|della|di)\b/i);
  });

  it("turns an unknown code into a plain Error that names only the SQLSTATE", () => {
    const result = mapReviewError({ code: "P0001", message: "secret internal detail 42" });
    expect(result).not.toBeInstanceOf(ApiError);
    expect(result.message).toBe("Unexpected database error P0001");
    const other = mapReviewError({ code: "XX000", message: "relation invoice_line broke" });
    expect(other.message).toBe("Unexpected database error XX000");
  });
});
