import { describe, expect, it } from "vitest";
import { avtQuery, periodQuery, unmappedQuery } from "@/server/reports/schemas";

describe("periodQuery", () => {
  it("defaults the period to day", () => {
    expect(periodQuery.parse({})).toEqual({ period: "day" });
  });
  it("accepts day, week and month with an anchor date", () => {
    for (const period of ["day", "week", "month"]) {
      expect(periodQuery.parse({ period, date: "2026-11-04" })).toEqual({
        period,
        date: "2026-11-04",
      });
    }
  });
  it("accepts custom with both ends", () => {
    expect(periodQuery.parse({ period: "custom", from: "2026-11-01", to: "2026-11-07" })).toEqual({
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-07",
    });
  });
  it("refuses custom without to, or without from", () => {
    expect(periodQuery.safeParse({ period: "custom", from: "2026-11-01" }).success).toBe(false);
    expect(periodQuery.safeParse({ period: "custom", to: "2026-11-01" }).success).toBe(false);
    expect(periodQuery.safeParse({ period: "custom" }).success).toBe(false);
  });
  it("refuses from and to on a period that is not custom", () => {
    expect(
      periodQuery.safeParse({ period: "week", from: "2026-11-01", to: "2026-11-07" }).success,
    ).toBe(false);
  });
  it("refuses an impossible date", () => {
    expect(periodQuery.safeParse({ period: "day", date: "2026-13-01" }).success).toBe(false);
    expect(periodQuery.safeParse({ period: "day", date: "2026-02-30" }).success).toBe(false);
    expect(periodQuery.safeParse({ period: "day", date: "04/11/2026" }).success).toBe(false);
  });
  it("refuses an unknown period and an extra key", () => {
    expect(periodQuery.safeParse({ period: "year" }).success).toBe(false);
    expect(periodQuery.safeParse({ period: "day", tenant: "x" }).success).toBe(false);
  });
});

describe("avtQuery and unmappedQuery", () => {
  it("avt: an optional uuid", () => {
    expect(avtQuery.parse({})).toEqual({});
    expect(avtQuery.parse({ count: "c5000000-0000-4000-8000-000000000002" })).toEqual({
      count: "c5000000-0000-4000-8000-000000000002",
    });
    expect(avtQuery.safeParse({ count: "x" }).success).toBe(false);
    expect(
      avtQuery.safeParse({ count: "c5000000-0000-4000-8000-000000000002", a: 1 }).success,
    ).toBe(false);
  });
  it("unmapped: an optional ISO date", () => {
    expect(unmappedQuery.parse({})).toEqual({});
    expect(unmappedQuery.parse({ week: "2026-11-04" })).toEqual({ week: "2026-11-04" });
    expect(unmappedQuery.safeParse({ week: "2026-13-04" }).success).toBe(false);
    expect(unmappedQuery.safeParse({ week: "2026-11-04", x: 1 }).success).toBe(false);
  });
});
