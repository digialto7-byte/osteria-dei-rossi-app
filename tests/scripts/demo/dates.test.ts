import { describe, expect, it } from "vitest";
import { addDays, romeToday } from "../../../scripts/lib/demo/dates";

describe("romeToday", () => {
  it.each([
    ["2026-10-24T10:00:00Z", "2026-10-24"],
    ["2026-10-24T21:59:59Z", "2026-10-24"],
    ["2026-10-24T22:00:00Z", "2026-10-25"],
    ["2026-10-24T22:30:00Z", "2026-10-25"],
    // DST ends on 2026-10-25 at 01:00Z: the day has 25 hours.
    ["2026-10-25T00:30:00Z", "2026-10-25"],
    ["2026-10-25T22:30:00Z", "2026-10-25"],
    ["2026-10-25T23:00:00Z", "2026-10-26"],
    // DST starts on 2027-03-28 at 01:00Z.
    ["2027-03-28T00:30:00Z", "2027-03-28"],
    ["2027-03-27T23:30:00Z", "2027-03-28"],
    ["2026-12-31T23:30:00Z", "2027-01-01"],
  ])("%s is %s in Rome", (iso, expected) => {
    expect(romeToday(new Date(iso))).toBe(expected);
  });

  it("does not depend on the process time zone", () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(romeToday(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("refuses an invalid date", () => {
    expect(() => romeToday(new Date("nope"))).toThrow(/invalid/);
  });
});

describe("addDays", () => {
  it.each([
    ["2026-10-25", 1, "2026-10-26"],
    ["2026-10-25", 0, "2026-10-25"],
    ["2026-10-25", -35, "2026-09-20"],
    ["2026-10-25", 27, "2026-11-21"],
    ["2026-10-31", 1, "2026-11-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    // Calendar arithmetic: the DST change days are not 23 or 25 hours long here.
    ["2026-10-24", 1, "2026-10-25"],
    ["2026-10-25", 1, "2026-10-26"],
    ["2027-03-27", 1, "2027-03-28"],
    ["2027-03-28", 1, "2027-03-29"],
  ])("%s + %i = %s", (date, n, expected) => {
    expect(addDays(date, n)).toBe(expected);
  });

  it("refuses a malformed or impossible date and a fractional offset", () => {
    expect(() => addDays("2026-10-5", 1)).toThrow(/YYYY-MM-DD/);
    expect(() => addDays("2026-02-30", 1)).toThrow(/YYYY-MM-DD/);
    expect(() => addDays("2026-13-01", 1)).toThrow(/YYYY-MM-DD/);
    expect(() => addDays("2026-10-25T00:00:00Z", 1)).toThrow(/YYYY-MM-DD/);
    expect(() => addDays("2026-10-25", 1.5)).toThrow(/integer/);
  });
});
