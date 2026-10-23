import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CostRulesForm } from "@/app/(owner)/costi/impostazioni/cost-rules-form";
import { plainHtml } from "./cost-fixtures";

const render = (props: Record<string, unknown> = {}) =>
  plainHtml(
    renderToStaticMarkup(
      createElement(CostRulesForm, {
        state: { avgCostN: "3", priceVariancePct: "10", saleVatPct: "10" },
        errors: {},
        busy: false,
        saved: false,
        onChange: () => undefined,
        onSubmit: () => undefined,
        ...props,
      } as never),
    ),
  );

describe("CostRulesForm", () => {
  it("has the three labelled rules, the VAT hint and one button", () => {
    const html = render();
    for (const label of [
      "Acquisti nella media",
      "Soglia avviso prezzi (%)",
      "IVA sui prezzi di vendita (%)",
      "Da confermare con il commercialista.",
      "Regole di calcolo",
    ]) {
      expect(html).toContain(label);
    }
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html.replace(/<label[\s\S]*?<\/label>/g, "")).not.toMatch(/<input\b/);
  });

  it("shows an error and a save confirmation", () => {
    expect(render({ errors: { avgCostN: "fuori dai limiti" } })).toContain("fuori dai limiti");
    expect(render({ saved: true })).toContain("Regole salvate.");
  });
});
