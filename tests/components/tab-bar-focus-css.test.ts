import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
const hideRule = css.slice(css.indexOf("body:has("));

describe("the tab bar gives way to a focused text field", () => {
  it("only toggles visibility: no display or layout property changes on focus", () => {
    expect(hideRule).toContain("visibility: hidden");
    expect(hideRule).not.toMatch(/display\s*:|padding|margin|height|position/);
  });

  it("comes back after a delay, so a tap on a button under the bar is not eaten by it", () => {
    expect(css).toMatch(
      /\[data-slot="bottom-tabs"\]\s*\{\s*transition: visibility 0s linear 350ms;/,
    );
    expect(hideRule).toContain("transition-delay: 0s");
  });
});
