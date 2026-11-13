import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLink } from "@/components/brand";

describe("BrandLink (the wordmark in the header band)", () => {
  const html = renderToStaticMarkup(createElement(BrandLink));

  it("is one link to Home, named for a screen reader", () => {
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*href="\/"/);
    expect(html).toMatch(/<a[^>]*aria-label="Osteria Dei Rossi, Home"/);
  });

  it("shows the wordmark and the brand mark inside the link", () => {
    expect(html).toContain("Osteria Dei Rossi");
    expect(html).toContain('data-slot="brand-mark"');
  });

  it("is at least 44 px tall", () => {
    expect(html).toMatch(/<a[^>]*class="[^"]*min-h-tap/);
  });

  // N1 (docs/plans/2026-11-13-ux-quick-wins.md): the global focus ring is about 2:1 on the green band, so every control on the band
  // draws its ring in band-ink instead.
  it("draws its focus ring in band-ink, which is readable on the green band", () => {
    expect(html).toMatch(/<a[^>]*class="[^"]*focus-visible:outline-band-ink/);
  });
});
