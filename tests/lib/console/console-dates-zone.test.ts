// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { formatInstant, formatLongDay, romeToday } from "@/lib/console/console-dates";
import { applyVenueSettings, resetVenueSettings } from "@/lib/venue/current";
import { ME_SETTINGS } from "../../helpers/me-data";

afterEach(resetVenueSettings);

// SP1 step 8: the platform console keeps the platform zone (Europe/Rome), never the venue zone the browser store holds for a tenant.
describe("the console helpers ignore the venue store's zone", () => {
  const instant = "2026-12-10T23:30:00Z"; // Rome: the 11th; Lisbon: still the 10th

  it("romeToday, formatLongDay and formatInstant give Rome's day while the store holds Europe/Lisbon", () => {
    applyVenueSettings({ ...ME_SETTINGS, timeZone: "Europe/Lisbon" });
    expect(romeToday(new Date(instant))).toBe("2026-12-11");
    expect(formatLongDay(instant)).toBe("11 dic 2026");
    expect(formatInstant(instant)).toBe("11 dic 2026, 00:30");
  });

  it("and the same with the store empty", () => {
    expect(romeToday(new Date(instant))).toBe("2026-12-11");
    expect(formatLongDay(instant)).toBe("11 dic 2026");
  });
});
