import { describe, expect, it } from "vitest";
import { assertFresh, MAX_BACKUP_AGE_HOURS } from "../../../scripts/lib/backup/freshness";

// The weekly restore check proves the daily job ran: the newest copy must be younger than 36 hours (plan §3.1.5.2).
const NOW = new Date("2026-11-09T04:00:00Z");
const ago = (hours: number) => ({
  createdTime: new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
});

describe("assertFresh", () => {
  it("limits the age to 36 hours", () => {
    expect(MAX_BACKUP_AGE_HOURS).toBe(36);
  });

  it("passes a copy 35 hours old and one exactly 36 hours old", () => {
    expect(() => assertFresh(ago(35), NOW)).not.toThrow();
    expect(() => assertFresh(ago(36), NOW)).not.toThrow();
  });

  it("throws backup_stale for a copy 37 hours old", () => {
    expect(() => assertFresh(ago(37), NOW)).toThrow("backup_stale");
  });

  it("throws backup_missing when there is none", () => {
    expect(() => assertFresh(null, NOW)).toThrow("backup_missing");
  });

  it("treats a creation time in the future or an unreadable one as unusable", () => {
    expect(() => assertFresh(ago(-2), NOW)).toThrow("backup_stale");
    expect(() => assertFresh({ createdTime: "yesterday" }, NOW)).toThrow("backup_stale");
  });
});
