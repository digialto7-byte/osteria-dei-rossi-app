import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarginRow } from "@/app/(owner)/margini/margin-row";
import type { PlateMarginPct } from "@/server/costing/types";
import { plainHtml } from "./cost-fixtures";

const PLATE: PlateMarginPct = {
  recipeKey: "cc000000-0000-4000-8000-0000000000cc",
  name: "Spezzatino con polenta (demo)",
  foodCostPct: 18.8542,
  gpPct: 81.1458,
  targetGpPct: 70,
  status: "ok",
};

const render = (plate: unknown) =>
  plainHtml(
    renderToStaticMarkup(createElement("ul", null, createElement(MarginRow, { plate } as never))),
  );

describe("MarginRow (V6.2)", () => {
  it("words the three percentages in a .num line and the status in a badge", () => {
    const html = render(PLATE);
    expect(html).toContain("Spezzatino con polenta (demo)");
    expect(html).toMatch(
      /<p class="num[^"]*"[^>]*>Food cost 18,9 % · GP 81,1 % · obiettivo 70 %<\/p>/,
    );
    expect(html).toContain("In linea");
  });

  it("says below target and incomplete data in words", () => {
    expect(render({ ...PLATE, status: "below_target" })).toContain("Sotto obiettivo");
    const incomplete = render({
      ...PLATE,
      foodCostPct: null,
      gpPct: null,
      status: "incomplete",
    });
    expect(incomplete).toContain("Dati incompleti");
    expect(incomplete).not.toContain("Food cost");
    expect(incomplete).toContain("obiettivo 70 %");
  });

  it("shows no euro sign and no 'Costo' next to a number, even if the props carry a euro field", () => {
    const html = render({ ...PLATE, foodCostEur: 2.0567, salePriceEur: 12, grossMarginEur: 8.85 });
    expect(html).not.toContain("€");
    expect(html).not.toMatch(/Costo\s*\d/i);
    expect(html).not.toContain("2,06");
    expect(html).not.toContain("2.0567");
    expect(html).not.toContain("8,85");
  });

  it("does not link to the owner's cost page", () => {
    expect(render(PLATE)).not.toContain("/costi");
  });

  it("escapes a name that contains markup", () => {
    const html = render({ ...PLATE, name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("links the plate's name to its breakdown (P1-10), a 44 px target, and nothing in euro came with it", () => {
    const html = render(PLATE);
    const anchor = /<a\b[^>]*>Spezzatino con polenta \(demo\)<\/a>/.exec(html)![0];
    expect(anchor).toContain('href="/margini/cc000000-0000-4000-8000-0000000000cc"');
    expect(anchor).toContain("min-h-tap");
    expect(html).not.toContain("€");
  });
});
