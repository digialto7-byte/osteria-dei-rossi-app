/** WCAG 2.5.5 / PRD: every control is at least 44 CSS px tall. */
export const TAP_TARGET_PX = 44;

/**
 * The smallest height a boundingBox may report for a 44 px control. The phone project emulates a
 * Pixel 7 (device pixel ratio 2.625), where 44 px is 115.5 device pixels: depending on where the
 * control lands vertically, Chromium snaps it and reports 43.99997. One LayoutUnit (1/64 px) is
 * Chromium's layout precision, so anything within it is the 44 px the CSS asked for.
 */
export const MIN_MEASURED_TAP_PX = TAP_TARGET_PX - 1 / 64;

/**
 * Runs inside the page (Playwright serialises it, so it uses no import): the controls under `main` and the nav links that are
 * visible and shorter than `min`. A radio inside a label is measured through the label (the 44 px hit target around the 20 px dot);
 * a visible radio with no wrapping label is measured itself, so it fails instead of being skipped.
 */
export function smallTapTargets(min: number): string[] {
  const selector =
    "main button, main input:not([type=checkbox]):not([type=radio]), main select, main label:has(input[type=radio]), main input[type=radio]:not(label input), nav a";
  return [...document.querySelectorAll<HTMLElement>(selector)]
    .filter((el) => {
      // Playwright's own notion of visible: a non-empty box and not visibility: hidden.
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
    })
    .filter((el) => el.getBoundingClientRect().height < min)
    .map((el) => `height=${el.getBoundingClientRect().height} ${el.outerHTML.slice(0, 200)}`);
}
