import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLink } from "@/components/brand";

describe("BrandLink (the wordmark in the header band)", () => {
  const html = renderToStaticMarkup(createElement(BrandLink));

  it("is one link to Oggi, named for a screen reader", () => {
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*href="\/"/);
    expect(html).toMatch(/<a[^>]*aria-label="Osteria Dei Rossi, Oggi"/);
  });

  it("shows the wordmark and the brand mark inside the link", () => {
    expect(html).toContain("Osteria Dei Rossi");
    expect(html).toContain('data-slot="brand-mark"');
  });

  it("is at least 44 px tall", () => {
    expect(html).toMatch(/<a[^>]*class="[^"]*min-h-tap/);
  });
});
