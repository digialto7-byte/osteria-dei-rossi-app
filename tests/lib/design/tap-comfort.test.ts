import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const theme = css.slice(css.indexOf("@theme {"), css.indexOf("/* Light theme colours"));

describe("the provisional tap-comfort token (W4, D2)", () => {
  it("is declared in rem, never below the 44 px floor, and marked as P0's to replace", () => {
    const match = /--spacing-tap-comfort:\s*([\d.]+)rem;/.exec(theme);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(2.75);
    expect(theme).toContain("Q-UX-W2");
  });

  it("is the bar's scroll padding too", () => {
    const rule = /html:has\(\[data-slot="sticky-action-bar"\]\)\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toContain("var(--spacing-tap-comfort)");
  });
});
