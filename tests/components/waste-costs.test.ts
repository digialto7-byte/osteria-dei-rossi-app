import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WasteCostsView } from "@/app/(owner)/magazzino/sprechi/waste-costs";
import type { WasteCosts } from "@/server/stock/types";

const ING = "1a000000-0000-4000-8000-00000000001a";
const ING2 = "1b000000-0000-4000-8000-00000000001b";

const DATA: WasteCosts = {
  from: "2026-10-01",
  to: "2026-10-23",
  valueEur: 15,
  unvaluedCount: 0,
  reasons: [
    {
      reasonCode: "spoilage",
      valueEur: 15,
      lines: [
        {
          ingredientId: ING,
          ingredientName: "Manzo muscolo (demo)",
          baseUnit: "kg",
          qty: 1.5,
          valueEur: 15,
        },
      ],
    },
  ],
};
const render = (over: Partial<WasteCosts> = {}) =>
  renderToStaticMarkup(createElement(WasteCostsView, { data: { ...DATA, ...over } }));

describe("WasteCostsView", () => {
  it("shows the total in a fact sheet, in euro the Italian way", () => {
    const html = render();
    expect(html).toMatch(
      /<dt[^>]*>Valore degli sprechi<\/dt><dd[^>]*class="num[^"]*"[^>]*>15,00 €<\/dd>/,
    );
  });

  it("formats thousands and cents as 1.234,50 €", () => {
    expect(render({ valueEur: 1234.5 })).toContain("1.234,50 €");
  });

  it("shows the reason label with its value and a line per ingredient", () => {
    const html = render();
    expect(html).toMatch(/Deteriorato · 15,00 €/);
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>Manzo muscolo \(demo\) 1,5 kg · 15,00 €<\/p>/);
  });

  it("a line without a price says so and is never worth 0,00 €", () => {
    const html = render({
      reasons: [
        {
          reasonCode: "spoilage",
          valueEur: 0,
          lines: [
            {
              ingredientId: ING2,
              ingredientName: "Sale grosso (demo)",
              baseUnit: "kg",
              qty: 1,
              valueEur: null,
            },
          ],
        },
      ],
      valueEur: 0,
      unvaluedCount: 1,
    });
    expect(html).toContain("Sale grosso (demo) 1 kg · valore non disponibile");
    expect(html).not.toMatch(/Sale grosso[^<]*0,00/);
  });

  it("the count of movements without a price shows only when above zero, with its hint", () => {
    expect(render()).not.toContain("Movimenti senza prezzo");
    const html = render({ unvaluedCount: 2 });
    expect(html).toMatch(
      /<dt[^>]*>Movimenti senza prezzo<\/dt><dd[^>]*class="num[^"]*"[^>]*>2<\/dd>/,
    );
    expect(html).toContain("Valore non calcolabile: manca un acquisto registrato.");
  });

  it("an empty period says so", () => {
    expect(render({ reasons: [], valueEur: 0 })).toContain("Nessuno spreco nel periodo.");
  });

  it("escapes markup in an ingredient name", () => {
    const html = render({
      reasons: [
        {
          reasonCode: "comp",
          valueEur: 1,
          lines: [
            {
              ingredientId: ING,
              ingredientName: "<script>x</script>",
              baseUnit: "kg",
              qty: 1,
              valueEur: 1,
            },
          ],
        },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
