import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("the sticky action bar's scroll padding (WCAG 2.4.11)", () => {
  it("reserves the bar's height and the safe area as bottom scroll padding", () => {
    const rule = /html:has\(\[data-slot="sticky-action-bar"\]\)\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/scroll-padding-bottom:[^;]*env\(safe-area-inset-bottom\)/);
  });
});
