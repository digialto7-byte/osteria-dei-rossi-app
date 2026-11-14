import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/contrast";
import { PRODUCT_BRAND, PRODUCT_THEMES } from "@/lib/design/tokens";
import {
  VENUE_LAYER_DEFAULT,
  VenueLayerRefused,
  requireVenueBand,
  venueLayer,
  venueSchema,
  type Hex,
} from "@/lib/design/venue-layer";
import { t } from "@/lib/i18n";

// docs/ux/costi-design-system.md §9 and docs/plans/2026-11-14-ux-p2-design-system.md §4.2: the venue sets one accent; the layer
// derives the band ink and refuses an accent that breaks a contrast rule. There is never a fallback colour.

describe("venueLayer", () => {
  it("accepts the osteria's approved green: Off-white ink at 10.67:1, the Coral rule at 4.43:1", () => {
    const band = venueLayer("#1C4130");
    expect(band).toMatchObject({ ok: true, band: "#1C4130", bandInk: "#F7F8F6" });
    if (!band.ok) throw new Error("unreachable");
    expect(band.bandInkRatio.toFixed(2)).toBe("10.67");
    expect(band.ruleRatio.toFixed(2)).toBe("4.43");
  });

  it("gives an ok result exactly the keys ok, band, bandInk, bandInkRatio, ruleRatio", () => {
    expect(Object.keys(venueLayer("#1C4130")).sort()).toEqual(
      ["band", "bandInk", "bandInkRatio", "ok", "ruleRatio"].sort(),
    );
  });

  it("refuses an accent no ink reaches 4.5:1 on, with the ratio and no colour", () => {
    const band = venueLayer("#808080");
    expect(band.ok).toBe(false);
    if (band.ok) throw new Error("unreachable");
    expect(band.refusal).toBe("band_ink_contrast");
    expect(band.ratio).toBeLessThan(4.5);
    expect(Object.keys(band).sort()).toEqual(["ok", "ratio", "refusal"]);
  });

  it("refuses an accent whose Coral rule is under 3:1", () => {
    const dark = venueLayer("#555555");
    expect(dark.ok).toBe(false);
    if (dark.ok) throw new Error("unreachable");
    expect(dark.refusal).toBe("rule_contrast");
    expect(dark.ratio).toBeLessThan(3);
    expect(dark.ratio).toBeCloseTo(contrastRatio(PRODUCT_THEMES.light.gold, "#555555"), 10);
  });

  it("refuses white: Charcoal ink passes, the Coral rule does not", () => {
    const white = venueLayer("#FFFFFF");
    expect(white).toMatchObject({ ok: false, refusal: "rule_contrast" });
  });

  it("picks the ink that contrasts more, and Off-white on a tie", () => {
    const band = venueLayer("#1C4130");
    if (!band.ok) throw new Error("unreachable");
    expect(band.bandInk).toBe(PRODUCT_BRAND.offWhite);
    expect(band.bandInkRatio).toBeGreaterThanOrEqual(
      contrastRatio("#1C4130", PRODUCT_BRAND.charcoal),
    );
  });

  it("throws the parser's TypeError on a malformed hex", () => {
    expect(() => venueLayer("#12345" as Hex)).toThrow(TypeError);
    expect(() => venueLayer("red" as Hex)).toThrow(TypeError);
  });

  it("can set only the band and its ink: no status, action or focus colour", () => {
    const band = venueLayer("#1C4130");
    if (!band.ok) throw new Error("unreachable");
    expect(
      Object.keys(band).filter((k) => /accent|success|warning|danger|info|focus/i.test(k)),
    ).toEqual([]);
  });
});

describe("requireVenueBand", () => {
  it("returns the band and ink for a valid venue", () => {
    expect(requireVenueBand(VENUE_LAYER_DEFAULT)).toEqual({ band: "#1C4130", bandInk: "#F7F8F6" });
  });

  it("throws VenueLayerRefused for a refused accent and never returns a colour", () => {
    let thrown: unknown;
    let returned: unknown;
    try {
      returned = requireVenueBand({ name: "Bar", logo: null, accent: "#555555" });
    } catch (e) {
      thrown = e;
    }
    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(VenueLayerRefused);
    expect((thrown as VenueLayerRefused).refusal).toBe("rule_contrast");
    expect((thrown as VenueLayerRefused).ratio).toBeLessThan(3);
  });
});

describe("venueSchema", () => {
  const ok = { name: "Bar", logo: null, accent: "#1C4130" };

  it("parses a valid venue and uppercases the accent", () => {
    expect(venueSchema.parse({ ...ok, accent: "#1c4130" }).accent).toBe("#1C4130");
  });

  it("trims the name and refuses an empty one or one over 40 characters", () => {
    expect(venueSchema.parse({ ...ok, name: "  Bar  " }).name).toBe("Bar");
    expect(venueSchema.safeParse({ ...ok, name: "" }).success).toBe(false);
    expect(venueSchema.safeParse({ ...ok, name: "   " }).success).toBe(false);
    expect(venueSchema.safeParse({ ...ok, name: "x".repeat(40) }).success).toBe(true);
    expect(venueSchema.safeParse({ ...ok, name: "x".repeat(41) }).success).toBe(false);
  });

  it("accepts a same-origin logo path only", () => {
    expect(venueSchema.safeParse({ ...ok, logo: { src: "/logo.svg" } }).success).toBe(true);
    expect(venueSchema.safeParse({ ...ok, logo: { src: "/brand/venue/logo-2.png" } }).success).toBe(
      true,
    );
    // A browser's URL parser turns "\" into "/" and drops tabs and newlines, so these load from another origin.
    for (const src of [
      "//x.test/a.svg",
      "https://x.test/a.svg",
      "javascript:alert(1)",
      "",
      "/\\x.test/a.svg",
      "/\t/x.test/a.svg",
      "/\n/x.test/a.svg",
      "/ /x.test/a.svg",
      "/logo.svg\u0000",
      "/a b.svg",
    ]) {
      expect(venueSchema.safeParse({ ...ok, logo: { src } }).success, src).toBe(false);
    }
  });

  it("refuses a malformed accent", () => {
    expect(venueSchema.safeParse({ ...ok, accent: "#12345" }).success).toBe(false);
    expect(venueSchema.safeParse({ ...ok, accent: "1C4130" }).success).toBe(false);
  });

  it("refuses keys a venue may not set", () => {
    expect(venueSchema.safeParse({ ...ok, font: "Comic" }).success).toBe(false);
  });
});

describe("VENUE_LAYER_DEFAULT", () => {
  it("is a valid venue: the osteria's name, no logo, the approved green", () => {
    expect(venueSchema.safeParse(VENUE_LAYER_DEFAULT).success).toBe(true);
    expect(VENUE_LAYER_DEFAULT.name).toBe(t("venue.name"));
    expect(VENUE_LAYER_DEFAULT.logo).toBeNull();
    expect(VENUE_LAYER_DEFAULT.accent).toBe("#1C4130");
  });

  it("uses an accent that docs/client-facts.md approves", () => {
    const facts = readFileSync(resolve(__dirname, "../../../docs/client-facts.md"), "utf8");
    expect(facts).toContain("#1C4130");
  });
});
