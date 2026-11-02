import { describe, expect, it } from "vitest";
import {
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
