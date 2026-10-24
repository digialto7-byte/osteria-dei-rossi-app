import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import {
  closeBody,
  cancelBody,
  countLinesBody,
  countStartBody,
  criticalBody,
  parseCountsQuery,
  parseCursor,
  parseReconciliationQuery,
  parseVarianceQuery,
} from "@/server/counts/schemas";
import {
  COUNT_LINES_MAX_PER_CALL,
  COUNT_LIST_PAGE_MAX,
  COUNT_QTY_MAX,
} from "@/server/counts/constants";

const ING = "1a000000-0000-4000-8000-00000000001a";
const LOC = "10000000-0000-4000-8000-0000000000a1";
const SESSION = "51000000-0000-4000-8000-000000000001";
const url = (query = "") => new URL(`http://localhost:3000/api/counts${query}`);
const line = (n: number, over: Record<string, unknown> = {}) => ({
  ingredientId: `1a000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  qty: 1,
  unit: "kg",
  ...over,
});

describe("countStartBody", () => {
  it("takes a type and an optional location", () => {
    expect(countStartBody.safeParse({ type: "daily" }).success).toBe(true);
    expect(countStartBody.safeParse({ type: "monthly", locationId: LOC }).success).toBe(true);
  });
  it("refuses an unknown type, a bad location and an extra key", () => {
    expect(countStartBody.safeParse({ type: "weekly" }).success).toBe(false);
    expect(countStartBody.safeParse({}).success).toBe(false);
    expect(countStartBody.safeParse({ type: "daily", locationId: "x" }).success).toBe(false);
    expect(countStartBody.safeParse({ type: "daily", unitCost: 1 }).success).toBe(false);
  });
});

describe("countLinesBody", () => {
  it("accepts one line, a cleared line (qty null) and a zero count", () => {
    expect(countLinesBody.safeParse({ lines: [line(1)] }).success).toBe(true);
    expect(countLinesBody.safeParse({ lines: [line(1, { qty: null })] }).success).toBe(true);
    expect(countLinesBody.safeParse({ lines: [line(1, { qty: 0 })] }).success).toBe(true);
  });

  it("is strict, at the top and in a line", () => {
    expect(countLinesBody.safeParse({ lines: [line(1)], note: "x" }).success).toBe(false);
    expect(countLinesBody.safeParse({ lines: [line(1, { unitCost: 1 })] }).success).toBe(false);
  });

  it("takes 1 to 200 lines", () => {
    expect(countLinesBody.safeParse({ lines: [] }).success).toBe(false);
    const many = (n: number) => ({ lines: Array.from({ length: n }, (_, i) => line(i + 1)) });
    expect(countLinesBody.safeParse(many(COUNT_LINES_MAX_PER_CALL)).success).toBe(true);
    expect(countLinesBody.safeParse(many(COUNT_LINES_MAX_PER_CALL + 1)).success).toBe(false);
  });

  it("refuses the same ingredient twice", () => {
    expect(countLinesBody.safeParse({ lines: [line(1), line(1, { qty: 2 })] }).success).toBe(false);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "1", undefined])("refuses qty %s", (qty) => {
    expect(countLinesBody.safeParse({ lines: [line(1, { qty })] }).success).toBe(false);
  });

  it("refuses a quantity above COUNT_QTY_MAX in base units, in any unit", () => {
    expect(countLinesBody.safeParse({ lines: [line(1, { qty: COUNT_QTY_MAX })] }).success).toBe(
      true,
    );
    expect(countLinesBody.safeParse({ lines: [line(1, { qty: COUNT_QTY_MAX + 1 })] }).success).toBe(
      false,
    );
    expect(
      countLinesBody.safeParse({ lines: [line(1, { qty: 100_000_000, unit: "g" })] }).success,
    ).toBe(true);
    expect(
      countLinesBody.safeParse({ lines: [line(1, { qty: 100_000_001, unit: "g" })] }).success,
    ).toBe(false);
  });

  it("refuses more than 4 decimals after conversion to the base unit", () => {
    expect(countLinesBody.safeParse({ lines: [line(1, { qty: 1.2345 })] }).success).toBe(true);
    expect(countLinesBody.safeParse({ lines: [line(1, { qty: 1.23456 })] }).success).toBe(false);
    expect(countLinesBody.safeParse({ lines: [line(1, { qty: 0.15, unit: "g" })] }).success).toBe(
      false,
    );
  });

  it("takes the five units only and wants uuids", () => {
    for (const unit of ["kg", "g", "l", "ml", "pz"]) {
      expect(countLinesBody.safeParse({ lines: [line(1, { unit })] }).success, unit).toBe(true);
    }
    expect(countLinesBody.safeParse({ lines: [line(1, { unit: "conf" })] }).success).toBe(false);
    expect(countLinesBody.safeParse({ lines: [line(1, { ingredientId: "x" })] }).success).toBe(
      false,
    );
  });
});

describe("close, cancel and critical bodies", () => {
  it("close and cancel take an empty object only", () => {
    expect(closeBody.safeParse({}).success).toBe(true);
    expect(cancelBody.safeParse({}).success).toBe(true);
    expect(closeBody.safeParse({ force: true }).success).toBe(false);
    expect(cancelBody.safeParse({ reason: "x" }).success).toBe(false);
  });
  it("critical takes an ingredient and a boolean", () => {
    expect(criticalBody.safeParse({ ingredientId: ING, critical: true }).success).toBe(true);
    expect(criticalBody.safeParse({ ingredientId: ING, critical: "yes" }).success).toBe(false);
    expect(criticalBody.safeParse({ ingredientId: ING }).success).toBe(false);
    expect(criticalBody.safeParse({ ingredientId: ING, critical: true, x: 1 }).success).toBe(false);
  });
});

describe("parseCursor", () => {
  it("reads <ISO instant>_<uuid>", () => {
    expect(parseCursor(`2026-10-23T10:12:00.123456+00:00_${SESSION}`)).toEqual({
      at: "2026-10-23T10:12:00.123456+00:00",
      id: SESSION,
    });
    expect(parseCursor(`2026-10-23T10:12:00Z_${SESSION}`)?.at).toBe("2026-10-23T10:12:00Z");
  });
  it("refuses anything else, a quote included", () => {
    expect(parseCursor("")).toBeNull();
    expect(parseCursor("2026-10-23_x")).toBeNull();
    expect(parseCursor(`2026-10-23T10:12:00Z_${SESSION}'`)).toBeNull();
    expect(parseCursor(`2026-10-23T10:12:00Z';--_${SESSION}`)).toBeNull();
  });
});

describe("parseCountsQuery", () => {
  it("defaults to all sessions, first page", () => {
    expect(parseCountsQuery(url())).toEqual({ status: "all", before: null });
  });
  it("reads status and the cursor", () => {
    const before = `2026-10-23T10:12:00Z_${SESSION}`;
    expect(parseCountsQuery(url(`?status=closed&before=${encodeURIComponent(before)}`))).toEqual({
      status: "closed",
      before: { at: "2026-10-23T10:12:00Z", id: SESSION },
    });
  });
  it.each([
    "?status=weekly",
    "?before=nope",
    `?before=${encodeURIComponent("2026-10-23T10:12:00Z_" + SESSION + "'")}`,
    "?page=2",
    "?status=open&status=closed",
  ])("answers 400 for %s", (query) => {
    expect(() => parseCountsQuery(url(query))).toThrow(ApiError);
    try {
      parseCountsQuery(url(query));
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
    }
  });
  it("the page size is bounded by the SQL limit", () => {
    expect(COUNT_LIST_PAGE_MAX).toBe(100);
  });
});

describe("parseVarianceQuery", () => {
  it("needs a session uuid", () => {
    expect(parseVarianceQuery(url(`?session=${SESSION}`))).toEqual({ session: SESSION });
    expect(() => parseVarianceQuery(url())).toThrow(ApiError);
    expect(() => parseVarianceQuery(url("?session=x"))).toThrow(ApiError);
    expect(() => parseVarianceQuery(url(`?session=${SESSION}&x=1`))).toThrow(ApiError);
  });
});

describe("parseReconciliationQuery", () => {
  it("has no defaults of its own (the service applies the Rome month)", () => {
    expect(parseReconciliationQuery(url())).toEqual({ from: null, to: null, location: null });
  });
  it("reads ISO dates and a location", () => {
    expect(parseReconciliationQuery(url(`?from=2026-10-01&to=2026-10-31&location=${LOC}`))).toEqual(
      { from: "2026-10-01", to: "2026-10-31", location: LOC },
    );
  });
  it.each([
    "?from=2026-13-01",
    "?to=31/10/2026",
    "?location=x",
    "?from=2026-10-01&from=2026-10-02",
  ])("answers 400 for %s", (query) => {
    expect(() => parseReconciliationQuery(url(query))).toThrow(ApiError);
  });
});
