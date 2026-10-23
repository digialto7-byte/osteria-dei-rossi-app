import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FixedCostForm } from "@/app/(owner)/costi/impostazioni/fixed-cost-form";
import { emptyFixedCostForm } from "@/lib/costing/cost-forms";
import type { FixedCostPeriod } from "@/server/costing/types";
import { PERIOD, plainHtml } from "./cost-fixtures";

const render = (props: Record<string, unknown> = {}) =>
  plainHtml(
    renderToStaticMarkup(
      createElement(FixedCostForm, {
        state: emptyFixedCostForm(),
        errors: {},
        periods: [] as FixedCostPeriod[],
        busy: false,
        saved: false,
        onChange: () => undefined,
        onSubmit: () => undefined,
        ...props,
      } as never),
    ),
  );
const outsideLabels = (html: string) => html.replace(/<label[\s\S]*?<\/label>/g, "");

describe("FixedCostForm", () => {
  it("every input sits inside a Field label, with the four labels of the plan", () => {
    const html = render();
    expect(outsideLabels(html)).not.toMatch(/<(input|select|textarea)\b/);
    for (const label of ["Mese", "Affitto", "Personale (totale del mese)", "Utenze"]) {
      expect(html).toContain(label);
    }
  });

  it("the amounts have a decimal keypad and the month is a month input", () => {
    const html = render();
    expect(html.match(/inputMode="decimal"/gi)).toHaveLength(3);
    expect(html).toContain('type="month"');
  });

  it("has one primary button and the monthly-totals-only hint", () => {
    const html = render();
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain("Salva costi fissi");
    expect(html).toContain("Inserisci solo totali mensili, mai importi per persona.");
    expect(html).toContain("Costi fissi mensili (IVA esclusa)");
  });

  it("shows field errors in words", () => {
    expect(render({ errors: { labourEur: "fuori dai limiti" } })).toContain("fuori dai limiti");
  });

  it("lists the months entered, marking a replaced entry in words", () => {
    const html = render({
      periods: [PERIOD, { ...PERIOD, id: "f0", totalEur: 12000, inForce: false, superseded: true }],
    });
    expect(html).toContain("Ottobre 2026 · 13.500,00 €");
    expect(html).toMatch(/Ottobre 2026 · 12\.000,00 €[\s\S]*sostituito/);
  });

  it("confirms a save", () => {
    expect(render({ saved: true })).toContain("Costi fissi salvati.");
  });
});
