import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FixedCostCard } from "@/app/(owner)/costi/fixed-cost-card";
import type { FixedCostStatus } from "@/server/costing/types";
import { plainHtml } from "./cost-fixtures";

const render = (status: FixedCostStatus) =>
  plainHtml(renderToStaticMarkup(createElement(FixedCostCard, { status })));

describe("FixedCostCard", () => {
  it("allocated: the month, the plates sold and the cost per plate", () => {
    const html = render({
      periodMonth: "2026-10-01",
      monthlyTotalEur: 13500,
      platesSold: 1500,
      perPlateEur: 9,
      reason: null,
    });
    expect(html).toContain("13.500,00 €");
    expect(html).toContain("1.500");
    expect(html).toContain("9,00 €");
    expect(html).not.toContain("Non ripartiti");
  });

  it("allocated: a FactList whose per-plate figure is a <strong> and whose card has no hairline grid", () => {
    const html = renderToStaticMarkup(
      createElement(FixedCostCard, {
        status: {
          periodMonth: "2026-10-01",
          monthlyTotalEur: 13500,
          platesSold: 1500,
          perPlateEur: 9,
          reason: null,
        },
      }),
    );
    expect(html).toMatch(
      /<dd data-testid="fixed-per-plate"[^>]*><strong>[^<]*9,00[^<]*<\/strong><\/dd>/,
    );
    expect(html).toContain('data-testid="fixed-month"');
    expect(html).toContain('data-testid="fixed-sold"');
    expect(html).not.toContain("border-b");
    // Figures never break mid-number at 360 px (P2h review): no anywhere-wrap on these values.
    for (const id of ["fixed-month", "fixed-sold", "fixed-per-plate"]) {
      expect(new RegExp(`<dd data-testid="${id}"[^>]*>`).exec(html)?.[0], id).not.toContain(
        "overflow-wrap",
      );
    }
  });

  it("no sales: 'Non ripartiti' in words and the sentence that food cost % stays valid", () => {
    const html = render({
      periodMonth: "2026-10-01",
      monthlyTotalEur: 13500,
      platesSold: 0,
      perPlateEur: null,
      reason: "no_sales",
    });
    expect(html).toContain("Non ripartiti");
    expect(html).toContain(
      "Nessun piatto venduto negli ultimi 30 giorni: il costo fisso non è ripartito. Food cost % e GP % restano validi.",
    );
    expect(html).toContain("13.500,00 €");
    expect(html).not.toContain("Costo fisso per piatto");
  });

  it("no fixed costs entered: a link to the settings", () => {
    const html = render({
      periodMonth: null,
      monthlyTotalEur: null,
      platesSold: null,
      perPlateEur: null,
      reason: "no_fixed_costs",
    });
    expect(html).toContain("Non ripartiti");
    expect(html).toMatch(/href="\/costi\/impostazioni"[^>]*>Inserisci i costi fissi del mese\./);
  });
});
