import { describe, expect, it } from "vitest";
import { formatTime } from "@/lib/time/format";
import { venueDate } from "@/lib/time/venue-date";
import { afternoonOf, dayOtherThan, middayOf, nextMondayAfter, noNbsp } from "./alert-rules";

describe("nextMondayAfter", () => {
  it("is the Monday strictly after the date", () => {
    expect(nextMondayAfter("2026-10-24")).toBe("2026-10-26"); // Saturday
    expect(nextMondayAfter("2026-10-25")).toBe("2026-10-26"); // Sunday
    expect(nextMondayAfter("2026-10-26")).toBe("2026-11-02"); // Monday itself
    expect(nextMondayAfter("2026-10-28")).toBe("2026-11-02"); // Wednesday
  });
  it("crosses a year end", () => {
    expect(nextMondayAfter("2026-12-30")).toBe("2027-01-04");
  });
});

describe("the fixed clocks", () => {
  it.each(["2026-07-06", "2026-11-02", "2026-03-30", "2026-10-26"])(
    "%s: the afternoon is after the 11:00 cut-off and midday around noon, on the same Rome date",
    (date) => {
      const afternoon = new Date(afternoonOf(date));
      const morning = new Date(middayOf(date));
      expect(venueDate(afternoon)).toBe(date);
      expect(venueDate(morning)).toBe(date);
      expect(formatTime(afternoon) > "14:00").toBe(true);
      expect(formatTime(morning) >= "11:00" && formatTime(morning) <= "13:00").toBe(true);
    },
  );
});

describe("dayOtherThan", () => {
  it("takes the first candidate that is not avoided", () => {
    expect(dayOtherThan(["a", "b", "c"], "a")).toBe("b");
    expect(dayOtherThan(["a", "b", "c"], "x")).toBe("a");
  });
  it("throws when every candidate is avoided", () => {
    expect(() => dayOtherThan(["a"], "a")).toThrow();
  });
});

describe("noNbsp", () => {
  it("turns the no-break space before a unit into a plain space", () => {
    expect(noNbsp("10 kg")).toBe("10 kg");
  });
});
