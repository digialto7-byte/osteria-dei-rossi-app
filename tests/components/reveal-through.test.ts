// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PeriodPanel } from "@/app/(owner)/report/period-picker";

// The report's period tabpanel wraps the content under the picker. `.reveal > *` only reaches direct children of main, so globals.css has a
// matching rule for the children of a [data-reveal-through] box: same rise, same delays as when they were direct children of main.
afterEach(cleanup);
const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The animation-delay of the rule whose selector is exactly `selector`, or null. */
function delayOf(selector: string): string | null {
  for (const [, selectors = "", body = ""] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (selectors.split(",").some((s) => s.trim() === selector)) {
      const m = /animation-delay:\s*([\w.]+)\s*;/.exec(body);
      if (m) return m[1]!;
    }
  }
  return null;
}

describe("the rise through a wrapper box", () => {
  it("the panel carries the hook, and collapses when empty", () => {
    const { container } = render(
      createElement(PeriodPanel, { periodo: "giorno" }, createElement("p", null, "x")),
    );
    const panel = container.firstElementChild!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.hasAttribute("data-reveal-through")).toBe(true);
    // Empty, it must not add the page's 1.5 rem gap (gap-6): a negative margin cancels it and the role stays exposed.
    expect(panel.className).toContain("empty:-mt-6");
  });

  it("an empty panel renders no child nodes, so :empty matches", () => {
    const { container } = render(createElement(PeriodPanel, { periodo: "giorno" }));
    expect(container.firstElementChild!.childNodes).toHaveLength(0);
  });

  it("the box has no animation of its own", () => {
    expect(css).toMatch(/\.reveal\s*>\s*\[data-reveal-through\]\s*\{\s*animation:\s*none;\s*\}/);
  });

  it("its children rise like the 4th, 5th, 6th, 7th and 8th children of the page", () => {
    expect(css).toMatch(
      /\.reveal\s*>\s*\[data-reveal-through\]\s*>\s*\*\s*\{[^}]*animation:\s*var\(--animate-rise\)/,
    );
    const page = [4, 5, 6, 7].map((n) => delayOf(`.reveal > :nth-child(${n})`));
    const through = [
      delayOf(".reveal > [data-reveal-through] > *"),
      delayOf(".reveal > [data-reveal-through] > :nth-child(2)"),
      delayOf(".reveal > [data-reveal-through] > :nth-child(3)"),
      delayOf(".reveal > [data-reveal-through] > :nth-child(4)"),
    ];
    expect(through).toEqual(page);
    expect(delayOf(".reveal > [data-reveal-through] > :nth-child(n + 5)")).toBe(
      delayOf(".reveal > :nth-child(n + 8)"),
    );
  });
});
