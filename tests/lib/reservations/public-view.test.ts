import { describe, expect, it } from "vitest";
import { isMessageKey, messages } from "@/lib/i18n";
import { INTL_LOCALE } from "@/lib/i18n/locale";
import {
  dayLabel,
  errorMessage,
  isClosedDay,
  localeFromQuery,
  partyChoices,
  telHref,
} from "@/lib/reservations/public-view";

// Reservations plan §5 B11: the formatting helpers of the public pages. The database decides; these only choose words and shapes.
describe("localeFromQuery", () => {
  it("is Italian unless ?lang=en", () => {
    expect(localeFromQuery(undefined)).toBe("it");
    expect(localeFromQuery("it")).toBe("it");
    expect(localeFromQuery("en")).toBe("en");
    expect(localeFromQuery("fr")).toBe("it");
    expect(localeFromQuery(["en", "it"])).toBe("it");
    expect(localeFromQuery("EN")).toBe("it");
  });
});

describe("isClosedDay", () => {
  // 2026-11-20 is a Friday (ISO weekday 5); 2026-11-22 a Sunday (7); 2026-11-23 a Monday (1).
  it("matches a closed weekday (ISO 1 to 7) and a closed date, and nothing else", () => {
    expect(isClosedDay("2026-11-20", [5], [])).toBe(true);
    expect(isClosedDay("2026-11-20", [4, 6], [])).toBe(false);
    expect(isClosedDay("2026-11-22", [7], [])).toBe(true);
    expect(isClosedDay("2026-11-23", [1], [])).toBe(true);
    expect(isClosedDay("2026-12-25", [], ["2026-12-25"])).toBe(true);
    expect(isClosedDay("2026-12-26", [], ["2026-12-25"])).toBe(false);
    expect(isClosedDay("2026-11-20", [], [])).toBe(false);
  });
});

describe("partyChoices", () => {
  it("lists 1 to the maximum", () => {
    expect(partyChoices(4)).toEqual([1, 2, 3, 4]);
    expect(partyChoices(1)).toEqual([1]);
    expect(partyChoices(0)).toEqual([]);
  });
});

describe("telHref", () => {
  it("keeps digits and a leading plus", () => {
    expect(telHref("+39 000 0000001")).toBe("tel:+390000000001");
    expect(telHref("010 000 000")).toBe("tel:010000000");
  });
});

describe("dayLabel", () => {
  it("writes the date in the page's language", () => {
    expect(dayLabel("2026-11-20", "it")).toBe("ven 20 novembre 2026");
    expect(dayLabel("2026-11-20", "en")).toMatch(/Fri,? 20 November 2026/);
  });

  // SP1 step 12 (H10): the date is a calendar date read at noon UTC, so the label is the same on both clock-change days, whatever the zone.
  it.each([
    ["2026-03-29", "it", "dom 29 marzo 2026"],
    ["2026-03-29", "en", "Sun, 29 March 2026"],
    ["2026-10-25", "it", "dom 25 ottobre 2026"],
    ["2026-10-25", "en", "Sun, 25 October 2026"],
  ] as const)(
    "%s in %s on a DST day is exactly %j, as with the old Rome zone",
    (date, locale, expected) => {
      expect(dayLabel(date, locale)).toBe(expected);
      // The rendering before SP1 (zone Europe/Rome on the same noon-UTC instant): the same string.
      const before = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Rome",
      }).format(new Date(`${date}T12:00:00Z`));
      expect(dayLabel(date, locale)).toBe(before);
    },
  );
});

describe("errorMessage", () => {
  it("maps a code and a reason to a message in the page's language", () => {
    expect(errorMessage({ code: "rate_limited" }, "it")).toBe(
      messages.it["publicReservationError.rate_limited"],
    );
    expect(
      errorMessage({ code: "slot_unavailable", details: { reason: "slot_limit" } }, "en"),
    ).toBe(messages.en["publicReservationError.slot.slot_limit"]);
    expect(errorMessage({ code: "invalid_request", details: { reason: "email" } }, "it")).toBe(
      messages.it["publicReservationError.field.email"],
    );
    for (const code of [
      "form_too_fast",
      "form_expired",
      "form_invalid",
      "not_found",
      "link_invalid",
      "cancel_closed",
      "status_invalid",
    ]) {
      expect(errorMessage({ code }, "en"), code).toBe(
        messages.en[
          `publicReservationError.${{ status_invalid: "cancel_status" }[code as "status_invalid"] ?? code}` as keyof typeof messages.en
        ],
      );
    }
    expect(errorMessage({ code: "reservations_unconfigured" }, "it")).toBe(
      messages.it["publicReservationError.unconfigured"],
    );
  });

  it("falls back to a generic message for an unknown code, an unknown reason or no details", () => {
    expect(errorMessage({ code: "internal" }, "it")).toBe(
      messages.it["publicReservation.error.generic"],
    );
    expect(errorMessage({ code: "slot_unavailable", details: { reason: "nope" } }, "it")).toBe(
      messages.it["publicReservation.error.generic"],
    );
    expect(errorMessage({ code: "invalid_request" }, "en")).toBe(
      messages.en["publicReservation.error.generic"],
    );
  });

  it("only ever returns a catalogue message", () => {
    expect(isMessageKey("publicReservation.error.generic")).toBe(true);
  });
});

describe("the catalogues", () => {
  it("have the same public reservation keys in Italian and English, none empty", () => {
    const keys = Object.keys(messages.it).filter((k) => /^publicReservation(Error)?\./.test(k));
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(key in messages.en, key).toBe(true);
      expect(messages.it[key as keyof typeof messages.it].length, key).toBeGreaterThan(0);
      expect(messages.en[key as keyof typeof messages.en].length, key).toBeGreaterThan(0);
    }
  });

  it("never name a table, a price or a cost in the customer's text", () => {
    for (const locale of ["it", "en"] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        if (!/^(publicReservation|publicReservationError|reservationMail)\./.test(key)) continue;
        expect(value, `${locale} ${key}`).not.toMatch(/€|\bEUR\b|\bprezz|\bprice\b|\bcost/i);
        expect(value, `${locale} ${key}`).not.toMatch(/\btavol[oi]\b|\btables?\b/i);
      }
    }
  });
});
