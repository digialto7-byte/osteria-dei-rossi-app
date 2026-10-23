import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CostLines } from "@/app/(owner)/costi/ricette/[key]/cost-lines";
import type { CostLine } from "@/server/costing/types";
import { LINE, plainHtml } from "./cost-fixtures";

const render = (lines: CostLine[]) =>
  plainHtml(renderToStaticMarkup(createElement(CostLines, { lines })));

describe("CostLines", () => {
  it("shows the target name and the worked line in .num", () => {
    const html = render([LINE]);
    expect(html).toContain("Manzo muscolo (demo)");
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>5 kg × 10,00 €\/kg ÷ resa 1 = 50,00 €<\/p>/);
  });

  it("an incomplete line carries a warning badge with the reason in words", () => {
    const html = render([
      { ...LINE, unitCostEur: null, lineCostEur: null, incomplete: true, reason: "missing_price" },
    ]);
    expect(html).toContain("Manca il prezzo di un ingrediente");
    expect(html).toContain("bg-warning-bg");
    expect(html).not.toContain("0,00");
  });

  it("escapes a target name that contains markup", () => {
    const html = render([{ ...LINE, target: { kind: "recipe", id: "r", name: "<b>x</b>" } }]);
    expect(html).not.toContain("<b>x");
  });
});
