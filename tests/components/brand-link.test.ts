import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrandLink } from "@/components/brand";
import { ShellBrandLink } from "@/components/nav/shell-brand-link";
import { VENUE_LAYER_DEFAULT, type Venue } from "@/lib/design/venue-layer";
import { t } from "@/lib/i18n";

// A plain anchor: the static render has no app router, which `next/link` (inside `GuardedLink`) needs.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

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

// P2b-11: the link's accessible name is built from the venue object, so it never goes stale against the visible name. WCAG 2.5.3 (label in
// name): the accessible name contains the visible text (or, with a logo, the image's alt, which is the name).
describe("the home link's accessible name comes from the venue (WCAG 2.5.3)", () => {
  const OTHER: Venue = { name: "Trattoria Prova (demo)", logo: null, accent: "#1C4130" };
  const OTHER_LOGO: Venue = { ...OTHER, logo: { src: "/logo-prova.svg" } };
  const visibleText = (html: string) => html.replace(/<[^>]*>/g, "").trim();
  const labelOf = (html: string) => /<a[^>]*aria-label="([^"]*)"/.exec(html)?.[1];

  it.each([
    ["BrandLink", BrandLink],
    ["ShellBrandLink", ShellBrandLink],
  ] as const)(
    "%s names the link '{name}, Home' for each venue and contains the visible name",
    (_n, Link) => {
      for (const venue of [VENUE_LAYER_DEFAULT, OTHER]) {
        const html = renderToStaticMarkup(createElement(Link, { venue }));
        expect(labelOf(html)).toBe(`${venue.name}, Home`);
        expect(labelOf(html)!.toLowerCase()).toContain(visibleText(html).toLowerCase());
      }
    },
  );

  it.each([
    ["BrandLink", BrandLink],
    ["ShellBrandLink", ShellBrandLink],
  ] as const)("%s with a logo names the link after the logo's alt", (_n, Link) => {
    const html = renderToStaticMarkup(createElement(Link, { venue: OTHER_LOGO }));
    expect(labelOf(html)).toBe("Trattoria Prova (demo), Home");
    expect(html).toMatch(/<img[^>]*alt="Trattoria Prova \(demo\)"/);
  });

  it("says the venue's name only through the slot, in both languages", () => {
    expect(t("brand.homeLink", { name: "X" })).toBe("X, Home");
    expect(t("brand.homeLink", { name: "X" }, "en")).toBe("X, Home");
  });
});
