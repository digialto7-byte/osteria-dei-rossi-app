import type { Locator } from "@playwright/test";
import { contrastRatio } from "../../src/lib/design/contrast";

// Design-system checks on computed styles (docs/plans/2026-11-14-ux-p2-design-system.md §7): the page's real colours, as the browser
// resolved them, run through the same contrast maths as the token tests (src/lib/design/contrast.ts).

/** "rgb(28, 65, 48)" (or "rgba(...)" with full alpha) as "#1C4130". Anything else is a failure of the check, not a colour. */
export function rgbToHex(rgb: string): string {
  const match = /^rgba?\((\d+), (\d+), (\d+)(?:, 1)?\)$/.exec(rgb);
  if (!match) throw new Error(`not an opaque rgb() colour: "${rgb}"`);
  return `#${match
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** The computed value of one CSS property of the element. */
export async function computedStyle(locator: Locator, property: string): Promise<string> {
  return locator.evaluate(
    (el, name) => getComputedStyle(el).getPropertyValue(name).trim(),
    property,
  );
}

/** Contrast of two computed colours ("rgb(...)" strings), 1 to 21. */
export function computedContrast(foreground: string, background: string): number {
  return contrastRatio(rgbToHex(foreground), rgbToHex(background));
}
