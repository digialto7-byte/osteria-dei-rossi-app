// The venue layer (docs/ux/costi-design-system.md §9, ADR-045): a venue sets exactly a name, an optional logo and one accent colour.
// The accent re-values `--color-band`; `--color-band-ink` is derived from it. `venueLayer` refuses an accent that breaks a contrast
// rule and never substitutes a colour. Client-safe and pure. SP9 will produce a `Venue` from the tenant record.

import { z } from "zod";
import { t } from "@/lib/i18n";
import { contrastRatio, parseHex } from "./contrast";
import { PRODUCT_BRAND, PRODUCT_THEMES } from "./tokens";

/** A validated `#RRGGBB` value, uppercase. */
export type Hex = `#${string}`;

/** A same-origin path ("/…"), so it stays inside `img-src 'self'`. */
export interface VenueLogo {
  src: string;
}

/** Exactly what a tenant may set. */
export interface Venue {
  name: string;
  logo: VenueLogo | null;
  accent: Hex;
}

export const venueSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  logo: z.strictObject({ src: z.string().regex(/^\/(?!\/)/) }).nullable(),
  accent: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .transform((hex): Hex => hex.toUpperCase() as Hex),
}) satisfies z.ZodType<Venue, unknown>;

export type VenueRefusal = "band_ink_contrast" | "rule_contrast";

export type VenueBand =
  | { ok: true; band: Hex; bandInk: Hex; bandInkRatio: number; ruleRatio: number }
  | { ok: false; refusal: VenueRefusal; ratio: number };

/** The least contrast the band's ink needs on the accent (WCAG AA for normal text). */
const BAND_INK_MIN = 4.5;
/** The least contrast the Coral rule under the band needs against the accent (WCAG non-text). */
const RULE_MIN = 3;

const OFF_WHITE = PRODUCT_BRAND.offWhite as Hex;
const CHARCOAL = PRODUCT_BRAND.charcoal as Hex;

/**
 * The band and its ink for an accent, or the rule it breaks. Ink is Off-white or Charcoal, whichever contrasts more (a tie gives
 * Off-white). `band_ink_contrast` is checked first, then `rule_contrast` (Coral on the accent). A malformed hex throws `TypeError`.
 */
export function venueLayer(accent: Hex): VenueBand {
  parseHex(accent);
  const offWhiteRatio = contrastRatio(accent, OFF_WHITE);
  const charcoalRatio = contrastRatio(accent, CHARCOAL);
  const [bandInk, bandInkRatio] =
    offWhiteRatio >= charcoalRatio ? [OFF_WHITE, offWhiteRatio] : [CHARCOAL, charcoalRatio];
  if (bandInkRatio < BAND_INK_MIN) {
    return { ok: false, refusal: "band_ink_contrast", ratio: bandInkRatio };
  }
  const ruleRatio = contrastRatio(PRODUCT_THEMES.light.gold, accent);
  if (ruleRatio < RULE_MIN) return { ok: false, refusal: "rule_contrast", ratio: ruleRatio };
  return { ok: true, band: accent, bandInk, bandInkRatio, ruleRatio };
}

/** Thrown by `requireVenueBand` for an accent `venueLayer` refuses. */
export class VenueLayerRefused extends Error {
  constructor(
    readonly refusal: VenueRefusal,
    readonly ratio: number,
  ) {
    super(`venue accent refused: ${refusal} (${ratio.toFixed(2)}:1)`);
    this.name = "VenueLayerRefused";
  }
}

/** The two colours to put on the band, or a throw: there is no fallback colour. */
export function requireVenueBand(venue: Venue): { band: Hex; bandInk: Hex } {
  const result = venueLayer(venue.accent);
  if (!result.ok) throw new VenueLayerRefused(result.refusal, result.ratio);
  return { band: result.band, bandInk: result.bandInk };
}

/** Tenant #1's venue until SP9 serves it from the tenant record: the approved green (docs/client-facts.md), no logo. */
export const VENUE_LAYER_DEFAULT: Venue = { name: t("venue.name"), logo: null, accent: "#1C4130" };
