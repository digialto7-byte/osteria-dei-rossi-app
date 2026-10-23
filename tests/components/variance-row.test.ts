import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  VarianceRow,
  VarianceTotals,
} from "@/app/(owner)/magazzino/conteggi/[id]/scostamenti/variance-row";
import type { VarianceLine } from "@/server/counts/types";
import { ING } from "./count-fixtures";

const LINE: VarianceLine = {
  ingredientId: ING,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  expectedQty: 12.3,
  countedQty: 11.8,
  differenceQty: -0.5,
  postedQty: -0.5,
};
const render = (line: Partial<VarianceLine> = {}, valueEur?: number | null) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(VarianceRow, {
        line: { ...LINE, ...line },
        ...(valueEur === undefined ? {} : { valueEur }),
      }),
    ),
  );

describe("VarianceRow", () => {
  it("shows the name in bold and the quantities in one .num line", () => {
    const html = render();
    expect(html).toMatch(/<span class="[^"]*font-bold[^"]*"[^>]*>Manzo muscolo \(demo\)<\/span>/);
    expect(html).toMatch(
      /<p class="num[^"]*"[^>]*>Atteso 12,3 kg · Contato 11,8 kg · Differenza −0,5 kg<\/p>/,
    );
  });

  it("says 'Nessuna differenza' for a line that matched", () => {
    expect(render({ countedQty: 12.3, differenceQty: 0, postedQty: 0 })).toContain(
      "Nessuna differenza",
    );
  });

  it("without cost props there is no euro sign at all", () => {
    expect(render()).not.toContain("€");
    expect(render()).not.toContain("valore");
  });

  it("with a value: the amount with the real minus sign", () => {
    expect(render({}, -5)).toContain("−5,00 €");
    expect(render({}, 1234.5)).toContain("1.234,50 €");
  });

  it("with a null value: 'valore non disponibile', never 0,00 €", () => {
    const html = render({}, null);
    expect(html).toContain("valore non disponibile");
    expect(html).not.toContain("0,00");
  });

  it("escapes a name that contains markup", () => {
    const html = render({ name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("VarianceTotals", () => {
  const totals = { valueEur: -41.8, lossEur: -45, gainEur: 3.2, unvaluedCount: 1 };
  const html = renderToStaticMarkup(createElement(VarianceTotals, { totals, skipped: 2 }));

  it("lists the server's totals", () => {
    expect(html).toContain("Perdite");
    expect(html).toContain("−45,00 €");
    expect(html).toContain("Eccedenze");
    expect(html).toContain("3,20 €");
    expect(html).toContain("Netto");
    expect(html).toContain("−41,80 €");
  });

  it("shows the lines without a price and the uncounted ones", () => {
    expect(html).toMatch(/Righe senza prezzo[\s\S]*>1</);
    expect(html).toContain("Non contati: 2");
  });

  it("leaves the unpriced row out when there is none", () => {
    expect(
      renderToStaticMarkup(
        createElement(VarianceTotals, { totals: { ...totals, unvaluedCount: 0 }, skipped: 0 }),
      ),
    ).not.toContain("senza prezzo");
  });
});
