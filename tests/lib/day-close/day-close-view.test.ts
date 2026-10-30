import { describe, expect, it } from "vitest";
import { formatEuro } from "@/lib/money/format";
import {
  businessDayTitle,
  canCloseDay,
  differenceFigure,
  differenceSentence,
  differenceTone,
} from "@/lib/day-close/day-close-view";

const nb = (s: string) => s.replace(/(\d) (€|%)/g, "$1" + String.fromCharCode(160) + "$2");
const MINUS = "−";

describe("differenceSentence (app minus register)", () => {
  it("says the app records more", () => {
    expect(differenceSentence(12.5)).toBe(nb("L'app registra 12,50 € in più della cassa"));
  });
  it("says the app records less, with the size of the gap and no sign", () => {
    expect(differenceSentence(-3)).toBe(nb("L'app registra 3,00 € in meno della cassa"));
  });
  it("says they match at zero", () => {
    expect(differenceSentence(0)).toBe("App e cassa coincidono");
  });
  it("is available in English", () => {
    expect(differenceSentence(12.5, "en")).toBe(
      `The app records ${formatEuro(12.5, "en")} more than the register`,
    );
    expect(differenceSentence(0, "en")).toBe("The app and the register match");
  });
});

describe("differenceFigure", () => {
  it("shows a plus sign and the percentage", () => {
    expect(differenceFigure(12.5, 1)).toBe(nb("+12,50 € (+1,0 %)"));
  });
  it("uses the real minus sign U+2212, never a hyphen", () => {
    const text = differenceFigure(-5.5, -0.4);
    expect(text).toBe(nb(`${MINUS}5,50 € (${MINUS}0,4 %)`));
    expect(text).not.toContain("-");
  });
  it("shows zero without a sign", () => {
    expect(differenceFigure(0, 0)).toBe(nb("0,00 € (0,0 %)"));
  });
  it("leaves the percentage out when the register total was 0", () => {
    expect(differenceFigure(50, null)).toBe(nb("+50,00 €"));
  });
});

describe("differenceTone (reinforces the meaning, never carries it)", () => {
  it("maps the sign", () => {
    expect([differenceTone(12.5), differenceTone(-0.01), differenceTone(0)]).toEqual([
      "over",
      "under",
      "equal",
    ]);
  });
});

describe("businessDayTitle", () => {
  it("names the weekday and the date in Italian", () => {
    expect(businessDayTitle("2026-11-05")).toBe("Giornata di giovedì 5 novembre");
  });
  it("is available in English", () => {
    expect(businessDayTitle("2026-11-05", "en")).toMatch(/^Business day: Thursday,? 5 November$/);
  });
  it("is not moved by the time zone at the edges of the day", () => {
    expect(businessDayTitle("2026-10-25")).toBe("Giornata di domenica 25 ottobre");
    expect(businessDayTitle("2027-03-28")).toBe("Giornata di domenica 28 marzo");
  });
  it("refuses a date that does not exist", () => {
    expect(() => businessDayTitle("2026-13-01")).toThrow();
  });
});

describe("canCloseDay", () => {
  it("is for owner and admin only", () => {
    expect(canCloseDay("owner")).toBe(true);
    expect(canCloseDay("admin")).toBe(true);
    expect(canCloseDay("waiter")).toBe(false);
    expect(canCloseDay("chef")).toBe(false);
    expect(canCloseDay(undefined)).toBe(false);
  });
});
