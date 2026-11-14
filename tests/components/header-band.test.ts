import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HeaderBand } from "@/components/header-band";
import { VENUE_LAYER_DEFAULT } from "@/lib/design/venue-layer";

describe("HeaderBand", () => {
  it("is one banner with the green band classes and the brand slot", () => {
    const html = renderToStaticMarkup(
      createElement(HeaderBand, { brand: createElement("span", null, "MARCHIO") }),
    );
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html).toMatch(/<header class="band border-b-2 border-gold"/);
    expect(html).toContain("MARCHIO");
  });

  it("renders an account slot only when given one", () => {
    const brand = createElement("span", null, "MARCHIO");
    expect(renderToStaticMarkup(createElement(HeaderBand, { brand }))).not.toContain("CONTO");
    expect(
      renderToStaticMarkup(
        createElement(HeaderBand, { brand, account: createElement("span", null, "CONTO") }),
      ),
    ).toContain("CONTO");
  });

  // Venue layer (ADR-045): the band wears the venue's accent as two custom properties, and nothing else.
  it("sets exactly the band and band-ink properties from the venue, and nothing else", () => {
    const html = renderToStaticMarkup(
      createElement(HeaderBand, {
        brand: createElement("span", null, "MARCHIO"),
        venue: VENUE_LAYER_DEFAULT,
      }),
    );
    expect(html).toContain('style="--color-band:#1C4130;--color-band-ink:#F7F8F6"');
    expect(html.match(/style=/g)).toHaveLength(1);
    expect(html).toMatch(/<header class="band border-b-2 border-gold" style=/);
  });

  it("has no style attribute without a venue (the product band stays Forest)", () => {
    const html = renderToStaticMarkup(
      createElement(HeaderBand, { brand: createElement("span", null, "MARCHIO") }),
    );
    expect(html).not.toContain("style=");
  });

  it("refuses a venue whose accent breaks a contrast rule instead of falling back to a colour", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(HeaderBand, {
          brand: createElement("span", null, "MARCHIO"),
          venue: { name: "Bar", logo: null, accent: "#555555" },
        }),
      ),
    ).toThrow(/rule_contrast/);
  });
});

describe("the venue's name has one source", () => {
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(join(dir, e.name))
        : /\.(ts|tsx)$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
    );

  it('t("venue.name") appears in src/ only in src/lib/design/venue-layer.ts', () => {
    const users = files(SRC)
      .filter((f) => /\bt\(\s*["']venue\.name["']\s*\)/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length));
    expect(users).toEqual(["lib/design/venue-layer.ts"]);
  });
});
