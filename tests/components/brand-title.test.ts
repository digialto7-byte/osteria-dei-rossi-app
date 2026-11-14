import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandTitle } from "@/components/brand";
import { VENUE_LAYER_DEFAULT, type Venue } from "@/lib/design/venue-layer";

const WITH_LOGO: Venue = { ...VENUE_LAYER_DEFAULT, logo: { src: "/logo-test.svg" } };

// QW1 (docs/plans/2026-11-13-ux-quick-wins.md): on the guest booking page the venue name is not a link, because "/" sends a signed-out
// guest to the staff sign-in and loses the typed form.
describe("BrandTitle (the wordmark with no link)", () => {
  const html = renderToStaticMarkup(createElement(BrandTitle, { venue: VENUE_LAYER_DEFAULT }));

  it("renders no link", () => {
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("shows the venue's name as text and no brand mark", () => {
    expect(html).toContain("Osteria Dei Rossi");
    expect(html).not.toContain("brand-mark");
    expect(html).not.toContain("<img");
  });

  it("shows the logo alone, with the name as its alt, when the venue has one", () => {
    const logo = renderToStaticMarkup(createElement(BrandTitle, { venue: WITH_LOGO }));
    expect(logo.match(/<img /g)).toHaveLength(1);
    expect(logo).toMatch(/<img[^>]*alt="Osteria Dei Rossi"/);
    expect(logo.replace(/<[^>]*>/g, "")).toBe("");
  });

  it("is at least 44 px tall, like the link, so the band does not change height", () => {
    expect(html).toMatch(/class="[^"]*min-h-tap/);
  });
});
