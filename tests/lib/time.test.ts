import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/lib/time/format";

describe("formatDateTime (Europe/Rome)", () => {
  it("shows summer time (UTC+2) before the 2026-10-25 change", () => {
    expect(formatDateTime(new Date("2026-10-25T00:30:00Z"))).toBe("25/10/2026, 02:30");
  });

  it("shows winter time (UTC+1) after the 2026-10-25 change: 02:30 happens twice", () => {
    expect(formatDateTime(new Date("2026-10-25T01:30:00Z"))).toBe("25/10/2026, 02:30");
    expect(formatDateTime(new Date("2026-10-25T02:00:00Z"))).toBe("25/10/2026, 03:00");
  });

  it("shows winter time just before the 2027-03-28 change", () => {
    expect(formatDateTime(new Date("2027-03-28T00:59:00Z"))).toBe("28/03/2027, 01:59");
  });

  it("skips 02:00–03:00 local after the 2027-03-28 change", () => {
    expect(formatDateTime(new Date("2027-03-28T01:00:00Z"))).toBe("28/03/2027, 03:00");
  });

  it("uses the 24-hour clock in English too, still in Rome time", () => {
    expect(formatDateTime(new Date("2026-07-01T18:05:00Z"), "en")).toBe("01/07/2026, 20:05");
  });

  it("rejects an invalid date", () => {
    expect(() => formatDateTime(new Date("not a date"))).toThrow(RangeError);
  });
});
