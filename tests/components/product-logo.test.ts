// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRODUCT_THEMES } from "@/lib/design/tokens";
import { ProductLogo } from "@/components/product-logo";

// ADR-042 / ADR-045: the product layouts (sign-in and device pages) render the Costì logo (a <picture>: the reversed file in dark), whose size
// comes from CSS height only, so a replaced file needs no edit. Moved from costi-theme.test.ts in P2j, when the `data-brand` marker went away.
const parse = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc;
};

describe("ProductLogo", () => {
  const doc = parse(renderToStaticMarkup(createElement(ProductLogo)));

  it("is a picture whose dark source is the reversed horizontal logo", () => {
    const source = doc.querySelector("picture > source");
    // Screen only, like the dark theme: a printed page keeps the dark logo on white paper.
    expect(source?.getAttribute("media")).toBe("screen and (prefers-color-scheme: dark)");
    expect(source?.getAttribute("srcset")).toBe("/brand/costi/logo-horizontal-reversed.svg");
  });

  it("the img is the horizontal logo with alt Costì, h-7, and no width or height attribute", () => {
    const img = doc.querySelector("picture > img");
    expect(img?.getAttribute("src")).toBe("/brand/costi/logo-horizontal.svg");
    expect(img?.getAttribute("alt")).toBe("Costì");
    expect(img?.hasAttribute("width")).toBe(false);
    expect(img?.hasAttribute("height")).toBe(false);
    expect(img?.classList.contains("h-7")).toBe(true);
    expect(img?.classList.contains("w-auto")).toBe(true);
  });
});

describe("the two product layouts", () => {
  const LAYOUTS = ["login", "dispositivo"] as const;

  it.each(LAYOUTS)(
    "(public)/%s/layout.tsx exports the Forest theme colour and renders the logo, then the children as siblings",
    async (name) => {
      const mod = (await import(`@/app/(public)/${name}/layout`)) as {
        default: (props: { children: React.ReactNode }) => React.ReactElement;
        viewport: { themeColor: string };
      };
      expect(mod.viewport.themeColor).toBe(PRODUCT_THEMES.light.band);
      expect(mod.viewport.themeColor).toBe("#0E4D3A");
      const html = renderToStaticMarkup(
        mod.default({ children: createElement("p", null, "figlio") }),
      );
      const body = parse(html).body;
      expect([...body.children].map((el) => el.tagName)).toEqual(["PICTURE", "P"]);
      expect(body.querySelector("p")?.textContent).toBe("figlio");
    },
  );

  it.each(LAYOUTS)("(public)/%s/layout.tsx is a server layout: no use client", (name) => {
    const source = readFileSync(join(process.cwd(), `src/app/(public)/${name}/layout.tsx`), "utf8");
    expect(source).not.toMatch(/["']use client["']/);
    expect(source).not.toMatch(/CostiTheme|data-brand/);
    expect(source).toContain("ProductLogo");
  });
});
