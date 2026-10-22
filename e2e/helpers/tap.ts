/** WCAG 2.5.5 / PRD: every control is at least 44 CSS px tall. */
export const TAP_TARGET_PX = 44;

/**
 * The smallest height a boundingBox may report for a 44 px control. The phone project emulates a
 * Pixel 7 (device pixel ratio 2.625), where 44 px is 115.5 device pixels: depending on where the
 * control lands vertically, Chromium snaps it and reports 43.99997. One LayoutUnit (1/64 px) is
 * Chromium's layout precision, so anything within it is the 44 px the CSS asked for.
 */
export const MIN_MEASURED_TAP_PX = TAP_TARGET_PX - 1 / 64;
