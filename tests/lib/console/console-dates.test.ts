import { describe, expect, it } from "vitest";
import {
  EM_DASH,
  defaultRange,
  formatActivityDay,
  formatInstant,
  formatLongDay,
  rangeProblem,
  romeToday,
} from "@/lib/console/console-dates";

describe("formatActivityDay", () => {
  it("is «oggi» for today", () => {
    expect(formatActivityDay("2026-11-15", "2026-11-15")).toBe("oggi");
  });
  it("is «ieri» for the day before, also across New Year", () => {
    expect(formatActivityDay("2026-11-14", "2026-11-15")).toBe("ieri");
    expect(formatActivityDay("2025-12-31", "2026-01-01")).toBe("ieri");
  });
  it("shows the day and month in the same year", () => {
    expect(formatActivityDay("2026-11-12", "2026-11-15")).toBe("12 nov");
  });
  it("adds the year for another year", () => {
    expect(formatActivityDay("2025-11-12", "2026-11-15")).toBe("12 nov 2025");
  });
  it("shows a dash for null", () => {
    expect(formatActivityDay(null, "2026-11-15")).toBe("—");
    expect(EM_DASH).toBe("—");
  });
  it("speaks English when asked", () => {
    expect(formatActivityDay("2026-11-15", "2026-11-15", "en")).toBe("today");
  });
});

describe("formatInstant", () => {
  it("shows winter time in Europe/Rome", () => {
    expect(formatInstant("2026-11-14T08:40:00Z")).toBe("14 nov 2026, 09:40");
  });
  it("shows summer time in Europe/Rome", () => {
    expect(formatInstant("2026-07-01T07:40:00Z")).toBe("1 lug 2026, 09:40");
  });
  it("rolls into the next Rome day", () => {
    expect(formatInstant("2026-11-14T23:30:00Z")).toBe("15 nov 2026, 00:30");
  });
  it("throws a RangeError for an invalid instant", () => {
    expect(() => formatInstant("not a date")).toThrow(RangeError);
  });
});

describe("formatLongDay", () => {
  it("formats a calendar day", () => {
    expect(formatLongDay("2026-10-21")).toBe("21 ott 2026");
  });
  it("converts an instant to its Rome day first", () => {
    expect(formatLongDay("2026-10-20T23:30:00Z")).toBe("21 ott 2026");
  });
});

describe("romeToday and defaultRange", () => {
  it("takes the Rome day of the clock", () => {
    expect(romeToday(new Date("2026-11-14T23:30:00Z"))).toBe("2026-11-15");
  });
  it("is the last 30 days, today included", () => {
    expect(defaultRange("2026-11-15")).toEqual({ dal: "2026-10-17", al: "2026-11-15" });
  });
});

describe("rangeProblem", () => {
  it("is null for a good range", () => {
    expect(rangeProblem("2026-10-17", "2026-11-15")).toBeNull();
    expect(rangeProblem("2026-11-15", "2026-11-15")).toBeNull();
  });
  it("is order when dal is after al", () => {
    expect(rangeProblem("2026-11-16", "2026-11-15")).toBe("order");
  });
  it("allows 366 days after dal and refuses 367", () => {
    expect(rangeProblem("2025-11-15", "2026-11-16")).toBeNull();
    expect(rangeProblem("2025-11-15", "2026-11-17")).toBe("span");
  });
  it("is invalid for a day that does not exist or is malformed", () => {
    expect(rangeProblem("2026-02-30", "2026-03-01")).toBe("invalid");
    expect(rangeProblem("2026-03-01", "2026-3-2")).toBe("invalid");
    expect(rangeProblem("", "2026-03-01")).toBe("invalid");
  });
});
