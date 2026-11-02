import { describe, expect, it } from "vitest";
import {
  dayServiceRow,
  daySessionLine,
  rowsFromPeriods,
  rowsToBody,
  servicesHint,
  servicesPreview,
  windowLabel,
} from "@/lib/services/services-view";
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
