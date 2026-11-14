import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLink } from "@/components/brand";
import { VENUE_LAYER_DEFAULT, type Venue } from "@/lib/design/venue-layer";

const WITH_LOGO: Venue = { ...VENUE_LAYER_DEFAULT, logo: { src: "/logo-test.svg" } };

describe("BrandLink (the wordmark in the header band)", () => {
  const html = renderToStaticMarkup(createElement(BrandLink, { venue: VENUE_LAYER_DEFAULT }));

  it("is one link to Home, named for a screen reader", () => {
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*href="\/"/);
    expect(html).toMatch(/<a[^>]*aria-label="Osteria Dei Rossi, Home"/);
  });

  it("shows the venue's name as text inside the link, with no brand mark (the logo slot replaced it)", () => {
    expect(html).toContain("Osteria Dei Rossi");
    expect(html).not.toContain("brand-mark");
    expect(html).not.toContain("<img");
  });

  it("shows the logo alone, with the name as its alt, when the venue has one", () => {
    const logo = renderToStaticMarkup(createElement(BrandLink, { venue: WITH_LOGO }));
    expect(logo.match(/<img /g)).toHaveLength(1);
    expect(logo).toMatch(/<img[^>]*src="\/logo-test\.svg"/);
    expect(logo).toMatch(/<img[^>]*alt="Osteria Dei Rossi"/);
    expect(logo).toMatch(/<img[^>]*class="[^"]*h-7/);
    expect(logo.replace(/<[^>]*>/g, "")).toBe("");
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
