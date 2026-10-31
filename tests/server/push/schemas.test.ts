import { describe, expect, it } from "vitest";
import { discardsQuery, forecastQuery, pushBody, pushListQuery } from "@/server/push/schemas";

describe("pushBody", () => {
  it("a start without a price defaults pushPrice to null", () => {
    expect(pushBody.parse({ pushed: true })).toEqual({ pushed: true, pushPrice: null });
  });

  it("a start with a price keeps it, and an explicit null is the same as none", () => {
    expect(pushBody.parse({ pushed: true, pushPrice: 12.5 })).toEqual({
      pushed: true,
      pushPrice: 12.5,
    });
    expect(pushBody.parse({ pushed: true, pushPrice: null })).toEqual({
      pushed: true,
      pushPrice: null,
    });
  });

  it("a stop is just { pushed: false }", () => {
    expect(pushBody.parse({ pushed: false })).toEqual({ pushed: false });
  });

  it.each([
    ["three decimals", { pushed: true, pushPrice: 12.345 }],
    ["zero", { pushed: true, pushPrice: 0 }],
    ["a negative price", { pushed: true, pushPrice: -1 }],
    ["above 10 000", { pushed: true, pushPrice: 10000.01 }],
    ["a price as text", { pushed: true, pushPrice: "12" }],
    ["a stop with a price", { pushed: false, pushPrice: 1 }],
    ["an extra key", { pushed: true, until: "2026-11-06T00:00:00Z" }],
    ["a cost key", { pushed: true, unit_cost: 3 }],
    ["pushed as text", { pushed: "yes" }],
    ["no pushed at all", { pushPrice: 12 }],
    ["an empty body", {}],
  ])("refuses %s", (_name, body) => {
    expect(pushBody.safeParse(body).success).toBe(false);
  });

  it("accepts the bounds: 0.01 and 10 000", () => {
    for (const pushPrice of [0.01, 10000]) {
      expect(pushBody.safeParse({ pushed: true, pushPrice }).success, String(pushPrice)).toBe(true);
    }
  });
});

describe("the query schemas", () => {
  it("the push-list query takes no key at all", () => {
    expect(pushListQuery.safeParse({}).success).toBe(true);
    expect(pushListQuery.safeParse({ foo: "1" }).success).toBe(false);
  });

  it("the forecast query takes an optional real date", () => {
    expect(forecastQuery.safeParse({}).success).toBe(true);
    expect(forecastQuery.safeParse({ date: "2026-11-05" }).success).toBe(true);
    expect(forecastQuery.safeParse({ date: "2026-13-01" }).success).toBe(false);
    expect(forecastQuery.safeParse({ date: "x" }).success).toBe(false);
    expect(forecastQuery.safeParse({ date: "2026-11-05", week: "2026-11-05" }).success).toBe(false);
  });

  it("the discards query takes an optional real date as the week", () => {
    expect(discardsQuery.safeParse({}).success).toBe(true);
    expect(discardsQuery.safeParse({ week: "2026-11-04" }).success).toBe(true);
    expect(discardsQuery.safeParse({ week: "2026-02-30" }).success).toBe(false);
    expect(discardsQuery.safeParse({ date: "2026-11-04" }).success).toBe(false);
  });
});
