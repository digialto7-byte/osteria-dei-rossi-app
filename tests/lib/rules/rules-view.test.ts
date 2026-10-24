import { describe, expect, it } from "vitest";
import {
  canEditRules,
  canReadRules,
  choiceLabel,
  incompleteCount,
  nextWindowLine,
  parseLevelInput,
  parseWholeInput,
  reasonWord,
  sourceHint,
  weekdayLabels,
  weekdayList,
} from "@/lib/rules/rules-view";

describe("roles (mirror the routes)", () => {
  it("canReadRules: owner, admin and chef", () => {
    for (const role of ["owner", "admin", "chef"]) expect(canReadRules(role), role).toBe(true);
    for (const role of ["waiter", "", "guest"]) expect(canReadRules(role), role).toBe(false);
  });
  it("canEditRules: owner and admin only", () => {
    for (const role of ["owner", "admin"]) expect(canEditRules(role), role).toBe(true);
    for (const role of ["chef", "waiter", "", "guest"])
      expect(canEditRules(role), role).toBe(false);
  });
});

describe("nextWindowLine", () => {
  it("words the server's window in venue time", () => {
    expect(nextWindowLine({ deliveryDate: "2026-11-05", orderByAt: "2026-11-03T10:00:00Z" })).toBe(
      "Prossimo ordine entro mar 03/11, 11:00 · consegna gio 05/11",
    );
  });
  it("keeps 11:00 local across the end of daylight saving time", () => {
    expect(nextWindowLine({ deliveryDate: "2026-10-27", orderByAt: "2026-10-25T10:00:00Z" })).toBe(
      "Prossimo ordine entro dom 25/10, 11:00 · consegna mar 27/10",
    );
  });
  it("shows an inconsistent window as given (no date arithmetic)", () => {
    expect(nextWindowLine({ deliveryDate: "2026-11-01", orderByAt: "2026-11-03T10:00:00Z" })).toBe(
      "Prossimo ordine entro mar 03/11, 11:00 · consegna dom 01/11",
    );
  });
  it("has an English wording", () => {
    expect(
      nextWindowLine({ deliveryDate: "2026-11-05", orderByAt: "2026-11-03T10:00:00Z" }, "en"),
    ).toBe("Next order by Tue 03/11, 11:00 · delivery Thu 05/11");
  });
  it("is null without a window", () => {
    expect(nextWindowLine(null)).toBeNull();
  });
});

describe("reasonWord", () => {
  it("words the four reasons", () => {
    expect(reasonWord("no_preferred_item")).toBe("Nessun fornitore preferito");
    expect(reasonWord("supplier_inactive")).toBe("Fornitore non attivo");
    expect(reasonWord("supplier_no_weekdays")).toBe("Fornitore senza giorni di consegna");
    expect(reasonWord("supplier_no_lead_time")).toBe("Fornitore senza giorni di anticipo");
    expect(reasonWord("no_preferred_item", "en")).toBe("No preferred supplier");
  });
  it("an unknown reason gets a neutral word, never the raw code", () => {
    expect(reasonWord("something_new")).toBe("Impostazioni incomplete");
  });
});

describe("sourceHint", () => {
  it("names the recipe version for a version source only", () => {
    expect(sourceHint("version", 3)).toBe("dalla ricetta v3");
    expect(sourceHint("version", 3, "en")).toBe("from recipe v3");
    expect(sourceHint("rule", 3)).toBeNull();
    expect(sourceHint(null, 3)).toBeNull();
  });
});

describe("weekdayLabels", () => {
  it("lists ISO weekdays 1 to 7, Monday first", () => {
    expect(weekdayLabels()).toEqual([
      { value: 1, label: "Lun" },
      { value: 2, label: "Mar" },
      { value: 3, label: "Mer" },
      { value: 4, label: "Gio" },
      { value: 5, label: "Ven" },
      { value: 6, label: "Sab" },
      { value: 7, label: "Dom" },
    ]);
    expect(weekdayLabels("en")[6]).toEqual({ value: 7, label: "Sun" });
  });
});

describe("parseLevelInput", () => {
  it("reads a decimal with a comma or a dot, and empty as null", () => {
    expect(parseLevelInput("5")).toEqual({ ok: true, value: 5 });
    expect(parseLevelInput(" 12,5 ")).toEqual({ ok: true, value: 12.5 });
    expect(parseLevelInput("0.0625")).toEqual({ ok: true, value: 0.0625 });
    expect(parseLevelInput("")).toEqual({ ok: true, value: null });
    expect(parseLevelInput("0")).toEqual({ ok: true, value: 0 });
  });
  it("refuses five decimals, a sign, text and anything above 100000", () => {
    for (const text of ["1,23456", "-1", "abc", "1e3", "1.000,5", "100000,0001", "100001"]) {
      expect(parseLevelInput(text), text).toEqual({ ok: false });
    }
    expect(parseLevelInput("100000")).toEqual({ ok: true, value: 100000 });
  });
});

describe("parseWholeInput", () => {
  it("reads whole numbers up to the maximum, and empty as null", () => {
    expect(parseWholeInput("2", 365)).toEqual({ ok: true, value: 2 });
    expect(parseWholeInput("365", 365)).toEqual({ ok: true, value: 365 });
    expect(parseWholeInput("0", 365)).toEqual({ ok: true, value: 0 });
    expect(parseWholeInput("  ", 365)).toEqual({ ok: true, value: null });
  });
  it("refuses decimals, signs, text and values above the maximum", () => {
    for (const text of ["1,5", "1.5", "-1", "x", "366", "1e2"]) {
      expect(parseWholeInput(text, 365), text).toEqual({ ok: false });
    }
  });
});

describe("small wordings", () => {
  it("weekdayList names the days in order, Monday first", () => {
    expect(weekdayList([4, 1])).toBe("Lun, Gio");
    expect(weekdayList([])).toBe("—");
    expect(weekdayList([7, 1], "en")).toBe("Mon, Sun");
  });
  it("choiceLabel joins the supplier and the pack", () => {
    expect(choiceLabel({ supplierName: "Macelleria X (demo)", packLabel: "5 kg" })).toBe(
      "Macelleria X (demo) · confezione 5 kg",
    );
    expect(choiceLabel({ supplierName: "Macelleria X (demo)", packLabel: "5 kg" }, "en")).toBe(
      "Macelleria X (demo) · pack 5 kg",
    );
  });
  it("incompleteCount counts the items the server marked incomplete", () => {
    expect(
      incompleteCount([
        { status: "ok" },
        { status: "incomplete" },
        { status: "off" },
        { status: "incomplete" },
      ]),
    ).toBe(2);
    expect(incompleteCount([])).toBe(0);
  });
});
