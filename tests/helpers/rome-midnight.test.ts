import { describe, expect, it, vi } from "vitest";
import { minutesToRomeMidnight, romeDate, waitPastRomeMidnight } from "./rome-midnight";

describe("minutesToRomeMidnight / romeDate", () => {
  it.each([
    ["2026-10-24T21:58:30Z", 1.5, "2026-10-24"], // 23:58:30 CEST
    ["2026-10-24T22:00:00Z", 1440, "2026-10-25"], // 00:00:00 CEST, a full day to the next
    ["2026-10-25T22:59:30Z", 0.5, "2026-10-25"], // 23:59:30 CET, after the clocks went back
    ["2026-10-25T01:30:00Z", 21 * 60 + 30, "2026-10-25"], // 02:30 CET
    ["2027-03-27T22:59:00Z", 1, "2027-03-27"], // 23:59:00 CET, the night the clocks go forward
    ["2027-03-28T22:00:00Z", 1440, "2027-03-29"],
    ["2026-07-01T12:00:00Z", 10 * 60, "2026-07-01"], // 14:00 CEST
  ])("%s -> %d minutes, business date %s", (iso, minutes, date) => {
    expect(minutesToRomeMidnight(new Date(iso))).toBeCloseTo(minutes, 6);
    expect(romeDate(new Date(iso))).toBe(date);
  });
});

describe("waitPastRomeMidnight", () => {
  const clock = (iso: string) => {
    let now = new Date(iso).getTime();
    return {
      now: () => new Date(now),
      sleep: vi.fn(async (ms: number) => {
        now += ms;
      }),
    };
  };

  it("does nothing when midnight is two minutes or more away", async () => {
    const c = clock("2026-10-24T21:58:00Z"); // exactly 2 minutes
    expect(await waitPastRomeMidnight(c)).toBe(0);
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it("waits past midnight when it is under two minutes away, and the date has moved on", async () => {
    const c = clock("2026-10-24T21:58:30Z"); // 23:58:30 CEST
    const waited = await waitPastRomeMidnight(c);
    expect(waited).toBeGreaterThan(90_000);
    expect(c.sleep).toHaveBeenCalledTimes(1);
    expect(romeDate(c.now())).toBe("2026-10-25");
    expect(minutesToRomeMidnight(c.now())).toBeGreaterThan(24 * 60 - 1);
  });

  it("also waits across the autumn change", async () => {
    const c = clock("2026-10-25T22:59:59Z"); // 23:59:59 CET
    await waitPastRomeMidnight(c);
    expect(romeDate(c.now())).toBe("2026-10-26");
  });
});
