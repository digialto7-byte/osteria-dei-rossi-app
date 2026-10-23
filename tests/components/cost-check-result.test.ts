import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CostCheckResultView } from "@/app/(owner)/costi/verifica/cost-check-result";
import type { CostCheckResponse } from "@/server/costing/cost-check-run";
import { plainHtml } from "./cost-fixtures";

const RESULT: CostCheckResponse = {
  at: "2026-10-23",
  tolerancePct: 5,
  compared: 4,
  withinTolerance: 2,
  listed: [
    { row: 2, name: "Tagliata (demo)", recipeKey: "k1", appEur: 10.6, sheetEur: 10, diffPct: 6 },
    { row: 4, name: "Ragù (demo)", recipeKey: "k3", appEur: 9.4, sheetEur: 10, diffPct: -6 },
  ],
  unmatched: [{ row: 6, name: "Piatto fantasma (demo)" }],
  duplicates: [
    { row: 7, name: "Tiramisù (demo)" },
    { row: 8, name: "Tiramisù (demo)" },
  ],
  incomplete: [{ row: 9, name: "Zuppa (demo)", recipeKey: "k5" }],
  invalid: [{ row: 10, code: "invalid_value" }],
};

const render = (result: CostCheckResponse) =>
  plainHtml(renderToStaticMarkup(createElement(CostCheckResultView, { result })));

describe("CostCheckResultView", () => {
  it("says how many plates were compared and how many are out of tolerance", () => {
    expect(render(RESULT)).toContain("Piatti confrontati: 4 · fuori tolleranza (oltre 5 %): 2");
  });

  it("lists each plate out of tolerance with its sign", () => {
    const html = render(RESULT);
    expect(html).toContain("Tagliata (demo)");
    expect(html).toContain("App 10,60 € · foglio 10,00 € · +6,0 %");
    expect(html).toContain("App 9,40 € · foglio 10,00 € · −6,0 %");
  });

  it("lists the rows it did not compare, each under its own heading", () => {
    const html = render(RESULT);
    for (const heading of ["Non trovati", "Doppi", "Costo incompleto", "Righe non valide"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("Piatto fantasma (demo)");
    expect(html).toContain("riga 6");
    expect(html).toContain("valore non valido");
  });

  it("leaves out the headings with nothing under them and says when all is within tolerance", () => {
    const html = render({
      ...RESULT,
      listed: [],
      unmatched: [],
      duplicates: [],
      incomplete: [],
      invalid: [],
    });
    expect(html).not.toContain("Non trovati");
    expect(html).not.toContain("Doppi");
    expect(html).toContain("Nessun piatto fuori tolleranza.");
  });

  it("escapes a plate name that contains markup", () => {
    const html = render({ ...RESULT, unmatched: [{ row: 6, name: "<img src=x>" }] });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
