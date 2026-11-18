import { describe, expect, it } from "vitest";
import {
  dayServiceRow,
  dayServiceRowParts,
  daySessionLine,
  rowsFromPeriods,
  rowsToBody,
  servicesHint,
  servicesPreview,
  windowLabel,
} from "@/lib/services/services-view";
import { formatEuro } from "@/lib/money/format";
import { SERVICE_PERIODS, SET_SERVICE_PERIODS } from "../../helpers/services-data";

describe("windowLabel", () => {
  it("prints the start and the end with an en dash and does nothing else", () => {
    expect(windowLabel("16:00", "02:00")).toBe("16:00–02:00");
    expect(windowLabel("11:00", "16:00")).toBe("11:00–16:00");
  });
});

describe("servicesPreview", () => {
  it("lists the services with their windows, in the order of the reply", () => {
    expect(servicesPreview(SERVICE_PERIODS.periods)).toBe("Pranzo 11:00–16:00 · Cena 16:00–02:00");
    expect(servicesPreview(SET_SERVICE_PERIODS.periods)).toBe(
      "Pranzo 11:00–18:00 · Aperitivo 18:00–19:30 · Cena 19:30–02:00",
    );
  });
  it("is empty for no period", () => {
    expect(servicesPreview([])).toBe("");
  });
});

describe("servicesHint", () => {
  it("says that before the first start counts as the first service, and that a change applies from now on", () => {
    expect(servicesHint(SERVICE_PERIODS.periods)).toBe(
      "Prima delle 11:00 conta come Pranzo. Le modifiche valgono per i tavoli aperti da ora in poi.",
    );
  });
  it("names the first service of the reply, whatever it is", () => {
    expect(servicesHint(SET_SERVICE_PERIODS.periods.slice(1))).toContain(
      "Prima delle 18:00 conta come Aperitivo.",
    );
  });
});

describe("rows", () => {
  it("rowsFromPeriods keeps key, name and start, in order", () => {
    expect(rowsFromPeriods(SET_SERVICE_PERIODS.periods)).toEqual([
      { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
      { key: "s_0123456789", name: "Aperitivo", startsAt: "18:00" },
      { key: "cena", name: "Cena", startsAt: "19:30" },
    ]);
  });
  it("rowsToBody sends exactly key, name and startsAt in screen order, names trimmed", () => {
    const body = rowsToBody([
      { key: null, name: "  Brunch ", startsAt: "09:30" },
      { key: "cena", name: "Cena", startsAt: "19:30" },
    ]);
    expect(body).toEqual({
      periods: [
        { key: null, name: "Brunch", startsAt: "09:30" },
        { key: "cena", name: "Cena", startsAt: "19:30" },
      ],
    });
    expect(Object.keys(body!.periods[0]!)).toEqual(["key", "name", "startsAt"]);
  });
  it("rowsToBody is null when a name or a start is blank", () => {
    expect(rowsToBody([{ key: null, name: "  ", startsAt: "09:30" }])).toBeNull();
    expect(rowsToBody([{ key: null, name: "Brunch", startsAt: "" }])).toBeNull();
  });
});

describe("dayServiceRow", () => {
  const nb = (text: string) => text.replace(/(\d) €/g, "$1\u00a0€");
  it("words the tables, covers and frozen total of a service", () => {
    expect(
      dayServiceRow({ name: "Pranzo", tables: 1, covers: 2, totalEur: 18, openTables: 0 }),
    ).toBe(nb("Pranzo · 1 tavolo · 2 coperti · 18,00 €"));
    expect(
      dayServiceRow({ name: "Cena", tables: 2, covers: 1, totalEur: 1234.5, openTables: 0 }),
    ).toBe(nb("Cena · 2 tavoli · 1 coperto · 1.234,50 €"));
  });
  it("adds the open tables only when there are some", () => {
    expect(
      dayServiceRow({ name: "Cena", tables: 2, covers: 5, totalEur: 135, openTables: 1 }),
    ).toBe(nb("Cena · 2 tavoli · 5 coperti · 135,00 € · 1 tavolo ancora aperto"));
    expect(
      dayServiceRow({ name: "Cena", tables: 2, covers: 5, totalEur: 135, openTables: 3 }),
    ).toContain("3 tavoli ancora aperti");
  });
});

describe("dayServiceRowParts", () => {
  const nb = (text: string) => text.replace(/(\d) €/g, "$1\u00a0€");
  const service = (over: Partial<Parameters<typeof dayServiceRow>[0]> = {}) => ({
    name: "Pranzo",
    tables: 1,
    covers: 2,
    totalEur: 18,
    openTables: 0,
    ...over,
  });

  it("lead + amount + tail is the row of dayServiceRow, for 0, 1 and 3 open tables", () => {
    for (const openTables of [0, 1, 3]) {
      const s = service({ openTables });
      const { lead, amount, tail } = dayServiceRowParts(s);
      expect(lead + amount + tail).toBe(dayServiceRow(s));
    }
  });

  it("the amount is the formatted total, the lead holds the labels", () => {
    const parts = dayServiceRowParts(service());
    expect(parts.amount).toBe(nb("18,00 €"));
    expect(parts.lead).toBe("Pranzo · 1 tavolo · 2 coperti · ");
    expect(parts.tail).toBe("");
  });

  it("the tail holds the open-tables words", () => {
    expect(dayServiceRowParts(service({ openTables: 1 })).tail).toBe(" · 1 tavolo ancora aperto");
    expect(dayServiceRowParts(service({ openTables: 3 })).tail).toBe(" · 3 tavoli ancora aperti");
  });

  it("a service named like the amount still splits on the real amount", () => {
    const parts = dayServiceRowParts(service({ name: nb("18,00 €") }));
    expect(parts.amount).toBe(nb("18,00 €"));
    expect(parts.lead).toBe(nb("18,00 €") + " · 1 tavolo · 2 coperti · ");
  });

  it("works in the en locale, where the message keeps the same order", () => {
    const parts = dayServiceRowParts(service(), "en");
    expect(parts.amount).toBe(formatEuro(18, "en"));
    expect(parts.lead).toBe("Pranzo · 1 table · 2 covers · ");
    expect(parts.lead + parts.amount + parts.tail).toBe(
      `Pranzo · 1 table · 2 covers · ${parts.amount}`,
    );
  });
});

describe("daySessionLine", () => {
  it("shows the opening time in Europe/Rome", () => {
    expect(daySessionLine("Tavolo 2 (demo)", "2026-11-04T20:30:00+00:00", "Cena")).toBe(
      "Tavolo 2 (demo) · aperto alle 21:30 · Cena",
    );
    expect(daySessionLine("Tavolo 1 (demo)", "2026-07-15T14:30:00+00:00", "Cena")).toBe(
      "Tavolo 1 (demo) · aperto alle 16:30 · Cena",
    );
  });
});
