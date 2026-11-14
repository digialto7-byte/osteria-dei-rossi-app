import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HIGH_CONTRAST_PAIRS } from "@/lib/design/tokens";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("high contrast on Sala (D10)", () => {
  it("shows a status badge as ink on surface with a 2 px ink ring", () => {
    const rule = /\[data-contrast="high"\] \[data-tone\]\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/color:\s*var\(--color-ink\)/);
    expect(rule?.[1]).toMatch(/background-color:\s*var\(--color-surface\)/);
    expect(rule?.[1]).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--color-ink\)/);
  });

  it("uses a pair that is promised at 7:1", () => {
    expect(HIGH_CONTRAST_PAIRS.some((pair) => pair.fg === "ink" && pair.bg === "surface")).toBe(
      true,
    );
  });
});
