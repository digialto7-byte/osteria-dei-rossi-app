import { describe, expect, it } from "vitest";
import { venueYear } from "@/lib/time/venue-date";

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
