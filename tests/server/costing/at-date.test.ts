import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { assertNoQuery, parseAtDate } from "@/server/costing/at-date";

const url = (query: string) => new URL(`http://localhost:3000/api/costs/plates${query}`);
// 2026-10-24T22:30Z is 00:30 on the 25th in Rome (CEST until the night of the 25th).
const LATE_SATURDAY = new Date("2026-10-24T22:30:00Z");
const NOON = new Date("2026-10-25T10:00:00Z");

function failure(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected an ApiError");
}

describe("parseAtDate", () => {
  it("returns null when there is no at parameter (current costs)", () => {
    expect(parseAtDate(url(""), NOON)).toBeNull();
  });

  it("accepts a past date and today", () => {
    expect(parseAtDate(url("?at=2026-10-20"), NOON)).toBe("2026-10-20");
    expect(parseAtDate(url("?at=2026-10-25"), NOON)).toBe("2026-10-25");
  });

  it.each(["2026-13-01", "2026-02-30", "25/10/2026", "2026-10-25T10:00", "2026-10-25 ", "x", ""])(
    "rejects the malformed value %j with 400",
    (value) => {
      const error = failure(() => parseAtDate(url(`?at=${encodeURIComponent(value)}`), NOON));
      expect(error.status).toBe(400);
      expect(error.code).toBe("invalid_request");
    },
  );

  it.each(["0000-01-01", "0000-12-31", "0000-02-29"])(
    "rejects the year 0 date %j with 400 (Date.UTC would read it as 1900)",
    (value) => {
      const error = failure(() => parseAtDate(url(`?at=${value}`), NOON));
      expect(error.status).toBe(400);
      expect(error.code).toBe("invalid_request");
    },
  );

  it("still accepts the first valid year and judges leap days in the real calendar", () => {
    expect(parseAtDate(url("?at=0001-01-01"), NOON)).toBe("0001-01-01");
    expect(parseAtDate(url("?at=0004-02-29"), NOON)).toBe("0004-02-29");
    expect(failure(() => parseAtDate(url("?at=0001-02-29"), NOON)).status).toBe(400);
    expect(failure(() => parseAtDate(url("?at=0100-02-29"), NOON)).status).toBe(400);
  });

  it("rejects an unknown parameter and a repeated at with 400", () => {
    expect(failure(() => parseAtDate(url("?at=2026-10-20&x=1"), NOON)).status).toBe(400);
    expect(failure(() => parseAtDate(url("?at=2026-10-20&at=2026-10-21"), NOON)).status).toBe(400);
  });

  it("uses the Rome date: at 22:30Z on the 24th the 25th is already today", () => {
    expect(parseAtDate(url("?at=2026-10-25"), LATE_SATURDAY)).toBe("2026-10-25");
  });

  it("refuses a date after today in Rome with 422 date_in_future", () => {
    const error = failure(() => parseAtDate(url("?at=2026-10-26"), LATE_SATURDAY));
    expect(error.status).toBe(422);
    expect(error.code).toBe("date_in_future");
    expect(error.message).toBe("Scegli una data non successiva a oggi.");
  });
});

describe("assertNoQuery", () => {
  it("accepts a URL without parameters", () => {
    expect(() => assertNoQuery(url(""))).not.toThrow();
  });

  it("rejects any parameter with 400", () => {
    expect(failure(() => assertNoQuery(url("?x=1"))).status).toBe(400);
  });
});
