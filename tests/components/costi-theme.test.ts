// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRODUCT_THEMES } from "@/lib/design/tokens";
import { CostiTheme } from "@/components/costi-theme";
import { ProductLogo } from "@/components/product-logo";

// ADR-042 / ADR-045: the Costì look is switched on by the `data-brand="costi"` marker (`CostiTheme`, a hidden span, so the children stay direct
// children of `main`). The product layouts also render the Costì logo (a <picture>: the reversed file in dark), whose size comes from CSS
// height only, so a replaced file needs no edit.
const parse = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc;
};

describe("CostiTheme", () => {
  it('is exactly <span data-brand="costi" hidden=""> with no children', () => {
    expect(renderToStaticMarkup(createElement(CostiTheme))).toBe(
      '<span data-brand="costi" hidden=""></span>',
    );
  });
});

describe("ProductLogo", () => {
  const doc = parse(renderToStaticMarkup(createElement(ProductLogo)));

  it("is a picture whose dark source is the reversed horizontal logo", () => {
    const source = doc.querySelector("picture > source");
    // Screen only, like the dark product theme: a printed page keeps the dark logo on white paper.
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
    "(public)/%s/layout.tsx exports the Forest theme colour and renders the marker, the logo, then the children as siblings",
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
      expect([...body.children].map((el) => el.tagName)).toEqual(["SPAN", "PICTURE", "P"]);
      expect(body.firstElementChild?.getAttribute("data-brand")).toBe("costi");
      expect(body.querySelector("p")?.textContent).toBe("figlio");
    },
  );

  it.each(LAYOUTS)("(public)/%s/layout.tsx is a server layout: no use client", (name) => {
    const source = readFileSync(join(process.cwd(), `src/app/(public)/${name}/layout.tsx`), "utf8");
    expect(source).not.toMatch(/["']use client["']/);
    expect(source).toContain("CostiTheme");
    expect(source).toContain("ProductLogo");
  });
});

describe("the venue's pages never switch the product look on (R1)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
    );

  it("neither (public)/layout.tsx nor anything under (public)/prenota/ mentions data-brand or CostiTheme", () => {
    const root = join(process.cwd(), "src/app/(public)");
    const guarded = [join(root, "layout.tsx"), ...files(join(root, "prenota"))];
    expect(guarded.length).toBeGreaterThan(3);
    for (const file of guarded) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/data-brand|CostiTheme/);
    }
  });

  it("outside the marker component, only globals.css, the tokens and tests name data-brand", () => {
    const offenders = files(join(process.cwd(), "src"))
      .filter((f) => /\.(ts|tsx|css)$/.test(f))
      .filter((f) => /data-brand/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(join(process.cwd(), "src/").length))
      .sort();
    expect(offenders).toEqual([
      "app/globals.css",
      "components/costi-theme.tsx",
      "lib/design/tokens.ts",
    ]);
  });
});
