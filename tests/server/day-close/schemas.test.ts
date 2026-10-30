import { describe, expect, it } from "vitest";
import { dayCloseBody, reportQuery } from "@/server/day-close/schemas";

describe("dayCloseBody", () => {
  it.each([["1234.5"], ["1222.00"], ["0"], ["9999999.99"], ["12"]])(
    "accepts the string %j",
    (registerTotal) => {
      expect(dayCloseBody.parse({ registerTotal })).toEqual({ registerTotal });
    },
  );

  it("keeps the string exactly as typed (money stays a string)", () => {
    expect(dayCloseBody.parse({ registerTotal: "1234.5" }).registerTotal).toBe("1234.5");
  });

  it("rejects a number: money travels as a string", () => {
    expect(dayCloseBody.safeParse({ registerTotal: 1234.5 }).success).toBe(false);
  });

  it.each([["1.234,50"], ["-1"], ["12345678"], ["1.234"], [""], ["1e3"], [" 5"], ["5."]])(
    "rejects %j",
    (registerTotal) => {
      expect(dayCloseBody.safeParse({ registerTotal }).success).toBe(false);
    },
  );

  it("accepts an ISO business date and rejects a wrong one", () => {
    expect(dayCloseBody.safeParse({ registerTotal: "1", businessDate: "2026-11-04" }).success).toBe(
      true,
    );
    expect(dayCloseBody.safeParse({ registerTotal: "1", businessDate: "2026-13-01" }).success).toBe(
      false,
    );
    expect(dayCloseBody.safeParse({ registerTotal: "1", businessDate: "04/11/2026" }).success).toBe(
      false,
    );
  });

  it("rejects a stray key and a missing total", () => {
    expect(dayCloseBody.safeParse({ registerTotal: "1", x: 1 }).success).toBe(false);
    expect(dayCloseBody.safeParse({}).success).toBe(false);
  });
});

describe("reportQuery", () => {
  it("has no date by default", () => {
    expect(reportQuery.parse({})).toEqual({});
  });
  it("accepts a real date and rejects a bad one", () => {
    expect(reportQuery.parse({ date: "2026-11-04" })).toEqual({ date: "2026-11-04" });
    expect(reportQuery.safeParse({ date: "2026-13-01" }).success).toBe(false);
    expect(reportQuery.safeParse({ date: "x" }).success).toBe(false);
    expect(reportQuery.safeParse({ date: "2026-11-04", x: "1" }).success).toBe(false);
  });
});
