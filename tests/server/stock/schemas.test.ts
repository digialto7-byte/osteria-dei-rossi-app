import { describe, expect, it } from "vitest";
import {
  idParams,
  parseLotsQuery,
  parseMovementsQuery,
  parseStockQuery,
  parseWasteCostsQuery,
  reverseBody,
  transferBody,
  wasteBody,
} from "@/server/stock/schemas";
import { STOCK_QTY_MAX } from "@/server/stock/constants";

const ID = "1a000000-0000-4000-8000-00000000001a";
const LOC = "10000000-0000-4000-8000-0000000000a1";
const LOC2 = "10000000-0000-4000-8000-0000000000a2";
const url = (query = "") => new URL(`http://localhost:3000/api/stock${query}`);
const waste = { ingredientId: ID, qty: 1.5, unit: "kg", reason: "spoilage" };

describe("wasteBody", () => {
  it("accepts the minimal body and the full one", () => {
    expect(wasteBody.safeParse(waste).success).toBe(true);
    expect(wasteBody.safeParse({ ...waste, locationId: LOC, lotId: LOC2 }).success).toBe(true);
  });

  it("is strict: an unknown key is refused", () => {
    expect(wasteBody.safeParse({ ...waste, unitCost: 1 }).success).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1.5", null])("refuses qty %s", (qty) => {
    expect(wasteBody.safeParse({ ...waste, qty }).success).toBe(false);
  });

  it("refuses a quantity above STOCK_QTY_MAX in base units, in any unit", () => {
    expect(wasteBody.safeParse({ ...waste, qty: STOCK_QTY_MAX }).success).toBe(true);
    expect(wasteBody.safeParse({ ...waste, qty: STOCK_QTY_MAX + 1 }).success).toBe(false);
    expect(wasteBody.safeParse({ ...waste, qty: 100_000_000, unit: "g" }).success).toBe(true);
    expect(wasteBody.safeParse({ ...waste, qty: 100_000_001, unit: "g" }).success).toBe(false);
  });

  it("refuses more than 4 decimals after conversion to the base unit", () => {
    expect(wasteBody.safeParse({ ...waste, qty: 1.2345 }).success).toBe(true);
    expect(wasteBody.safeParse({ ...waste, qty: 1.23456 }).success).toBe(false);
    expect(wasteBody.safeParse({ ...waste, qty: 500.5, unit: "g" }).success).toBe(true);
    expect(wasteBody.safeParse({ ...waste, qty: 0.1, unit: "g" }).success).toBe(true);
    expect(wasteBody.safeParse({ ...waste, qty: 0.15, unit: "g" }).success).toBe(false);
    expect(wasteBody.safeParse({ ...waste, qty: 0.00005, unit: "kg" }).success).toBe(false);
  });

  it("takes only the five units and the eight reasons", () => {
    for (const unit of ["kg", "g", "l", "ml", "pz"]) {
      expect(wasteBody.safeParse({ ...waste, unit }).success, unit).toBe(true);
    }
    expect(wasteBody.safeParse({ ...waste, unit: "conf" }).success).toBe(false);
    expect(wasteBody.safeParse({ ...waste, reason: "foo" }).success).toBe(false);
    expect(wasteBody.safeParse({ ...waste, reason: "count_correction" }).success).toBe(true);
  });

  it("wants uuids", () => {
    expect(wasteBody.safeParse({ ...waste, ingredientId: "x" }).success).toBe(false);
    expect(wasteBody.safeParse({ ...waste, locationId: "x" }).success).toBe(false);
    expect(wasteBody.safeParse({ ...waste, lotId: "x" }).success).toBe(false);
  });
});

describe("transferBody", () => {
  const body = { ingredientId: ID, qty: 2, unit: "kg", fromLocationId: LOC, toLocationId: LOC2 };
  it("accepts a transfer, with or without a lot", () => {
    expect(transferBody.safeParse(body).success).toBe(true);
    expect(transferBody.safeParse({ ...body, lotId: ID }).success).toBe(true);
  });
  it("needs both locations, is strict, shares the quantity rules", () => {
    expect(transferBody.safeParse({ ...body, toLocationId: undefined }).success).toBe(false);
    expect(transferBody.safeParse({ ...body, reason: "spoilage" }).success).toBe(false);
    expect(transferBody.safeParse({ ...body, qty: 1.23456 }).success).toBe(false);
    expect(transferBody.safeParse({ ...body, unit: "ml" }).success).toBe(true);
  });
});

describe("reverseBody and idParams", () => {
  it("the reverse body is an empty strict object", () => {
    expect(reverseBody.safeParse({}).success).toBe(true);
    expect(reverseBody.safeParse({ a: 1 }).success).toBe(false);
  });
  it("the path id is a uuid", () => {
    expect(idParams.safeParse({ id: ID }).success).toBe(true);
    expect(idParams.safeParse({ id: "nope" }).success).toBe(false);
  });
});

describe("query parsers", () => {
  it("GET /api/stock takes ?location=<uuid> and nothing else", () => {
    expect(parseStockQuery(url())).toEqual({ location: null });
    expect(parseStockQuery(url(`?location=${LOC}`))).toEqual({ location: LOC });
    expect(() => parseStockQuery(url("?location=x"))).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => parseStockQuery(url("?x=1"))).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => parseStockQuery(url(`?location=${LOC}&location=${LOC2}`))).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("GET /api/stock/lots needs ?ingredient and takes ?empty=1", () => {
    expect(parseLotsQuery(url(`?ingredient=${ID}`))).toEqual({
      ingredient: ID,
      includeEmpty: false,
    });
    expect(parseLotsQuery(url(`?ingredient=${ID}&empty=1`))).toEqual({
      ingredient: ID,
      includeEmpty: true,
    });
    expect(() => parseLotsQuery(url())).toThrowError(expect.objectContaining({ status: 400 }));
    // A malformed id is the same 404 as a missing ingredient: it reveals nothing about existence.
    expect(() => parseLotsQuery(url("?ingredient=x"))).toThrowError(
      expect.objectContaining({ status: 404, code: "not_found" }),
    );
    expect(() => parseMovementsQuery(url("?ingredient=x"))).toThrowError(
      expect.objectContaining({ status: 404, code: "not_found" }),
    );
    expect(() => parseLotsQuery(url(`?ingredient=${ID}&empty=yes`))).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("GET /api/stock/movements takes a cursor of the shape <ISO>_<uuid>, nothing else", () => {
    const before = `2026-10-23T10:00:00.123456+00:00_${LOC}`;
    expect(parseMovementsQuery(url(`?ingredient=${ID}`))).toEqual({ ingredient: ID, before: null });
    expect(
      parseMovementsQuery(url(`?ingredient=${ID}&before=${encodeURIComponent(before)}`)),
    ).toEqual({
      ingredient: ID,
      before: { createdAt: "2026-10-23T10:00:00.123456+00:00", id: LOC },
    });
    for (const bad of [
      "nope",
      `2026-10-23_${LOC}`,
      `2026-10-23T10:00:00Z,id.gt.0_${LOC}`,
      `2026-10-23T10:00:00Z_${LOC}"`,
    ]) {
      expect(
        () => parseMovementsQuery(url(`?ingredient=${ID}&before=${encodeURIComponent(bad)}`)),
        bad,
      ).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });

  it("GET /api/stock/waste-costs takes ISO dates, both or neither", () => {
    expect(parseWasteCostsQuery(url())).toEqual({ from: null, to: null });
    expect(parseWasteCostsQuery(url("?from=2026-10-01&to=2026-10-31"))).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(parseWasteCostsQuery(url("?from=2026-10-01"))).toEqual({ from: "2026-10-01", to: null });
    for (const bad of ["?from=01/10/2026", "?to=2026-13-01", "?from=2026-02-30", "?x=1"]) {
      expect(() => parseWasteCostsQuery(url(bad)), bad).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
    }
  });
});
