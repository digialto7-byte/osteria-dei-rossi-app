import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// UX plan C7 (P2-7): a list page is wider on a laptop, but a form stays one phone column wide (28rem = max-w-md) so its
// fields never stretch. A wide page (data-layout="wide") lays out its own forms.

const css = readFileSync("src/app/globals.css", "utf8");
const start = css.indexOf("@media (min-width: 64rem)");
const block = start === -1 ? "" : css.slice(start, css.indexOf("\n}\n", start));

describe("forms keep the phone column on a laptop", () => {
  it("has a rule from 1024 px (64rem) for main pages that are not wide", () => {
    expect(block).toContain('main:not(:has([data-layout="wide"]))');
  });

  it("caps a form, and the card around it, at 28rem", () => {
    expect(block).toMatch(/\bform\b/);
    expect(block).toContain("div:has(> form)");
    expect(block).toMatch(/max-width:\s*28rem/);
  });
});
