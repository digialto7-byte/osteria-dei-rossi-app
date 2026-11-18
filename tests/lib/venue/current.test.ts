import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_PAINT_VENUE_SETTINGS,
  venueSettingsSchema,
  type VenueSettings,
} from "@/lib/venue/settings";

const reported = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/report", () => ({ reportError: reported }));

const LISBON: VenueSettings = {
  timeZone: "Europe/Lisbon",
  locale: "en",
  currency: "EUR",
  receiptTypes: ["scontrino"],
  paymentTypes: ["card", "cash"],
};

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

async function load() {
  vi.resetModules();
  return import("@/lib/venue/current");
}

beforeEach(() => reported.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("the venue settings store on the server (no window)", () => {
  it("always answers the first-paint settings, even after apply, and is never filled", async () => {
    const store = await load();
    expect(store.currentVenueSettings()).toEqual(FIRST_PAINT_VENUE_SETTINGS);
    store.applyVenueSettings({ ...LISBON, receiptTypes: ["scontrino"] });
    expect(store.currentVenueSettings()).toEqual(FIRST_PAINT_VENUE_SETTINGS);
    expect(store.venueSettingsApplied()).toBe(false);
  });
});

describe("the venue settings store in the browser", () => {
  it("apply, then read, and the value is kept in localStorage", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const store = await load();
    expect(store.currentVenueSettings()).toEqual(FIRST_PAINT_VENUE_SETTINGS);
    expect(store.venueSettingsApplied()).toBe(false);
    store.applyVenueSettings({ ...LISBON, receiptTypes: ["scontrino"] });
    expect(store.venueSettingsApplied()).toBe(true);
    expect(store.currentVenueSettings().timeZone).toBe("Europe/Lisbon");
    expect(JSON.parse(storage.data.get("venue-settings")!)).toMatchObject({
      timeZone: "Europe/Lisbon",
    });
  });

  it("reads the last applied settings once, at module load", async () => {
    const storage = fakeStorage({ "venue-settings": JSON.stringify(LISBON) });
    vi.stubGlobal("window", { localStorage: storage });
    const store = await load();
    expect(store.currentVenueSettings()).toEqual(LISBON);
  });

  it("reset empties the store (first-paint settings again) and removes the localStorage key", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const store = await load();
    store.applyVenueSettings({ ...LISBON });
    store.resetVenueSettings();
    expect(store.currentVenueSettings()).toEqual(FIRST_PAINT_VENUE_SETTINGS);
    expect(store.venueSettingsApplied()).toBe(false);
    expect(storage.data.has("venue-settings")).toBe(false);
  });

  it("a corrupt localStorage value is treated as absent: store unfilled, first-paint formatter default, reported", async () => {
    for (const bad of ["{not json", JSON.stringify({ ...LISBON, currency: "USD" })]) {
      reported.mockClear();
      vi.stubGlobal("window", { localStorage: fakeStorage({ "venue-settings": bad }) });
      const store = await load();
      expect(store.venueSettingsApplied(), bad).toBe(false);
      expect(store.currentVenueSettings(), bad).toEqual(FIRST_PAINT_VENUE_SETTINGS);
      expect(reported, bad).toHaveBeenCalledTimes(1);
    }
  });

  it("a browser that refuses storage keeps the value in memory and reports the failure", async () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    vi.stubGlobal("window", { localStorage: refusing });
    const store = await load();
    expect(store.currentVenueSettings()).toEqual(FIRST_PAINT_VENUE_SETTINGS);
    store.applyVenueSettings({ ...LISBON });
    expect(store.currentVenueSettings().timeZone).toBe("Europe/Lisbon");
    store.resetVenueSettings();
    expect(store.currentVenueSettings()).toEqual(FIRST_PAINT_VENUE_SETTINGS);
    expect(reported).toHaveBeenCalledTimes(3);
  });

  it("t() and the formatters follow the store's locale and zone", async () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    vi.resetModules();
    const store = await import("@/lib/venue/current");
    const { t } = await import("@/lib/i18n");
    const { formatDateTime } = await import("@/lib/time/format");
    const { formatEuro } = await import("@/lib/money/format");
    const instant = new Date("2026-07-01T10:00:00Z");
    expect(t("home.greeting", { name: "Demo" })).toBe("Ciao, Demo");
    expect(formatDateTime(instant)).toBe("01/07/2026, 12:00");
    store.applyVenueSettings({ ...LISBON });
    expect(t("home.greeting", { name: "Demo" })).toBe("Hello, Demo");
    expect(formatDateTime(instant)).toBe("01/07/2026, 11:00");
    expect(formatEuro(1234.5).replaceAll(" ", " ")).toBe("€1,234.50");
    store.resetVenueSettings();
    expect(t("home.greeting", { name: "Demo" })).toBe("Ciao, Demo");
  });
});

describe("venueSettingsSchema", () => {
  it("accepts the defaults", () => {
    expect(venueSettingsSchema.parse(FIRST_PAINT_VENUE_SETTINGS)).toEqual(
      FIRST_PAINT_VENUE_SETTINGS,
    );
  });

  it("refuses currency USD, an unknown zone, an empty list, an unknown code and an extra key", () => {
    const bad = [
      { ...FIRST_PAINT_VENUE_SETTINGS, currency: "USD" },
      { ...FIRST_PAINT_VENUE_SETTINGS, timeZone: "Not/AZone" },
      { ...FIRST_PAINT_VENUE_SETTINGS, receiptTypes: [] },
      { ...FIRST_PAINT_VENUE_SETTINGS, paymentTypes: [] },
      { ...FIRST_PAINT_VENUE_SETTINGS, receiptTypes: ["voucher"] },
      { ...FIRST_PAINT_VENUE_SETTINGS, locale: "fr" },
      { ...FIRST_PAINT_VENUE_SETTINGS, vatRates: [22] },
    ];
    for (const value of bad) expect(venueSettingsSchema.safeParse(value).success).toBe(false);
  });

  it("the defaults list the catalogue in order (parity with src/server/bill/constants.ts)", async () => {
    const { RECEIPT_TYPES, PAYMENT_TYPES } = await import("@/server/bill/constants");
    expect(FIRST_PAINT_VENUE_SETTINGS.receiptTypes).toEqual([...RECEIPT_TYPES]);
    expect(FIRST_PAINT_VENUE_SETTINGS.paymentTypes).toEqual([...PAYMENT_TYPES]);
  });
});
