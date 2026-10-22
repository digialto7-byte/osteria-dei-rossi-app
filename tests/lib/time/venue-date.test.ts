import { describe, expect, it } from "vitest";
import { addDays, daysInclusive, venueDate, venueYear } from "@/lib/time/venue-date";

describe("venueYear (Europe/Rome)", () => {
  it("is still the old year one second before venue midnight on New Year", () => {
    expect(venueYear(new Date("2026-12-31T22:59:59Z"))).toBe(2026);
  });

  it("is the new year at venue midnight (23:00 UTC on 31 December)", () => {
    expect(venueYear(new Date("2026-12-31T23:00:00Z"))).toBe(2027);
  });

  it("reads mid-year dates normally", () => {
    expect(venueYear(new Date("2026-07-01T00:00:00Z"))).toBe(2026);
  });

  it("rejects an invalid date", () => {
    expect(() => venueYear(new Date("nope"))).toThrow(RangeError);
  });
});

describe("venueDate (Europe/Rome)", () => {
  it("is the next day shortly after 23:00 UTC in winter time", () => {
    expect(venueDate(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(venueDate(new Date("2026-12-31T22:59:00Z"))).toBe("2026-12-31");
  });

  it("follows the DST change of 25 October 2026 (summer time ends at 01:00 UTC)", () => {
    expect(venueDate(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(venueDate(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25");
    expect(venueDate(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
  });

  it("rejects an invalid date", () => {
    expect(() => venueDate(new Date("nope"))).toThrow(RangeError);
  });
});

describe("addDays and daysInclusive", () => {
  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-26", -29)).toBe("2026-09-27");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts both end days", () => {
    expect(daysInclusive("2026-10-26", "2026-10-26")).toBe(1);
    expect(daysInclusive("2026-01-01", "2027-01-01")).toBe(366);
    expect(daysInclusive("2026-01-01", "2027-01-02")).toBe(367);
    expect(daysInclusive("2026-10-27", "2026-10-26")).toBe(0);
  });
});
