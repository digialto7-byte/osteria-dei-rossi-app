import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import {
  checkLinePatchRules,
  lineParams,
  linePatchBody,
  notDuplicateBody,
} from "@/server/invoices/review-schemas";

const UUID = "1d000000-0000-4000-8000-000000000001";
const parse = (value: unknown) => linePatchBody.strict().safeParse(value);

describe("lineParams", () => {
  it("needs two uuids", () => {
    expect(lineParams.safeParse({ id: UUID, lineId: UUID }).success).toBe(true);
    expect(lineParams.safeParse({ id: UUID, lineId: "x" }).success).toBe(false);
    expect(lineParams.safeParse({ id: UUID }).success).toBe(false);
  });
});

describe("notDuplicateBody", () => {
  it("takes exactly one partnerId, a uuid", () => {
    expect(notDuplicateBody.safeParse({ partnerId: UUID }).success).toBe(true);
  });

  it.each([
    ["no body fields", {}],
    ["a partnerId that is not a uuid", { partnerId: "x" }],
    ["a null partnerId", { partnerId: null }],
    ["a number", { partnerId: 7 }],
    ["an extra key", { partnerId: UUID, extra: 1 }],
    ["a misspelt key", { partner: UUID }],
  ])("refuses %s", (_name, body) => {
    expect(notDuplicateBody.safeParse(body).success).toBe(false);
  });
});

describe("linePatchBody", () => {
  it("accepts every documented field", () => {
    const body = {
      qty: 2.5,
      unitPrice: 12.75,
      lineAmount: 31.875,
      vatRate: 10,
      supplierCode: "MAN-1",
      unit: "conf",
      ingredientId: UUID,
      pack: { count: 6, size: 1, unit: "kg", label: "cassa" },
      isStock: true,
      creditQty: 1,
      lotCode: "L42",
      expiry: "2026-12-01",
      reviewed: true,
    };
    expect(parse(body).success).toBe(true);
  });

  it("accepts null to unmap or clear a value", () => {
    const body = {
      ingredientId: null,
      unitPrice: null,
      vatRate: null,
      supplierCode: null,
      unit: null,
      lotCode: null,
      expiry: null,
      costCentreId: null,
    };
    expect(parse(body).success).toBe(true);
  });

  it("trims strings", () => {
    const parsed = parse({ lotCode: "  L42 ", supplierCode: " A " });
    expect(parsed.success && parsed.data).toMatchObject({ lotCode: "L42", supplierCode: "A" });
  });

  it.each([
    ["an empty body", {}],
    ["an unknown key", { qty: 1, extra: 1 }],
    ["a negative qty", { qty: -1 }],
    ["five decimals", { unitPrice: 1.23456 }],
    ["a qty above the cap", { qty: 1_000_001 }],
    ["a null qty", { qty: null }],
    ["a null lineAmount", { lineAmount: null }],
    ["a vat rate above 100", { vatRate: 101 }],
    ["a 65-char lotCode", { lotCode: "x".repeat(65) }],
    ["a 65-char supplierCode", { supplierCode: "x".repeat(65) }],
    ["an unknown unit", { unit: "cassa" }],
    ["a bad ingredient id", { ingredientId: "x" }],
    ["a bad cost centre id", { costCentreId: "x" }],
    ["a bad expiry", { expiry: "01/12/2026" }],
    ["reviewed false", { reviewed: false }],
    ["a pack of zero", { pack: { count: 0, size: 1, unit: "kg" } }],
    ["a pack without a unit", { pack: { count: 1, size: 1 } }],
    ["a pack with an unknown key", { pack: { count: 1, size: 1, unit: "kg", x: 1 } }],
    ["a pack unit conf", { pack: { count: 1, size: 1, unit: "conf" } }],
    ["a 31-char pack label", { pack: { count: 1, size: 1, unit: "kg", label: "x".repeat(31) } }],
    ["a non-boolean isStock", { isStock: "no" }],
    ["stock with a cost centre", { isStock: true, costCentreId: UUID }],
  ])("rejects %s", (_name, body) => {
    expect(parse(body).success).toBe(false);
  });
});

describe("checkLinePatchRules", () => {
  const failure = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      return error as ApiError;
    }
    return undefined;
  };

  it("needs a cost centre when the line becomes non-stock (AT4)", () => {
    const error = failure(() => checkLinePatchRules({ isStock: false }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "cost_centre_required" });
    expect(() => checkLinePatchRules({ isStock: false, costCentreId: null })).toThrow(ApiError);
  });

  it("accepts non-stock with a cost centre, and any stock change", () => {
    expect(() => checkLinePatchRules({ isStock: false, costCentreId: UUID })).not.toThrow();
    expect(() => checkLinePatchRules({ isStock: true })).not.toThrow();
    expect(() => checkLinePatchRules({ qty: 1 })).not.toThrow();
  });

  it("refuses a credit above the qty of the same body (AT4)", () => {
    const error = failure(() => checkLinePatchRules({ qty: 2, creditQty: 3 }));
    expect(error).toMatchObject({ status: 422, code: "credit_qty_exceeds_qty" });
    expect(() => checkLinePatchRules({ qty: 2, creditQty: 2 })).not.toThrow();
  });

  it("leaves a credit without a qty to the stored value", () => {
    expect(() => checkLinePatchRules({ creditQty: 3 })).not.toThrow();
  });
});
