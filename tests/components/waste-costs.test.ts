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
  rawValueEur: 15,
  batchValueEur: 0,
  unvaluedCount: 0,
  reasons: [
    {
      reasonCode: "spoilage",
      valueEur: 15,
      rawValueEur: 15,
      batchValueEur: 0,
      batchLines: [],
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
          rawValueEur: 0,
          batchValueEur: 0,
          batchLines: [],
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
          rawValueEur: 1,
          batchValueEur: 0,
          batchLines: [],
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

  describe("with batch waste (M15)", () => {
    const KEY = "ec000000-0000-4000-8000-0000000000e1";
    const combined = (): Partial<WasteCosts> => ({
      valueEur: 12.2,
      rawValueEur: 2.2,
      batchValueEur: 10,
      unvaluedCount: 1,
      reasons: [
        {
          reasonCode: "spoilage",
          valueEur: 6.5,
          rawValueEur: 0.5,
          batchValueEur: 6,
          lines: [
            {
              ingredientId: ING,
              ingredientName: "Cipolla (demo)",
              baseUnit: "kg",
              qty: 0.5,
              valueEur: 0.5,
            },
          ],
          batchLines: [
            {
              recipeKey: KEY,
              recipeName: "Ragù (demo)",
              portions: 3,
              valueEur: 6,
              unvaluedCount: 0,
            },
          ],
        },
        {
          reasonCode: "over_production",
          valueEur: 0,
          rawValueEur: 0,
          batchValueEur: 0,
          lines: [],
          batchLines: [
            {
              recipeKey: KEY,
              recipeName: "Brodo (demo)",
              portions: 20,
              valueEur: null,
              unvaluedCount: 1,
            },
          ],
        },
      ],
    });

    it("shows the total and, per reason, the warehouse and the preparations apart", () => {
      const html = render(combined());
      expect(html).toContain("12,20 €");
      expect(html).toMatch(/Deteriorato · 6,50 €/);
      expect(html).toMatch(/<p class="num[^"]*"[^>]*>Magazzino 0,50 €<\/p>/);
      expect(html).toMatch(/<p class="num[^"]*"[^>]*>Preparazioni 6,00 €<\/p>/);
    });

    it("words a batch line: recipe, portions and value", () => {
      expect(render(combined())).toMatch(
        /<p class="num[^"]*"[^>]*>Ragù \(demo\) · 3 porzioni · 6,00 €<\/p>/,
      );
    });

    it("a batch line with no complete cost says 'non valorizzato', never 0,00 €", () => {
      const html = render(combined());
      expect(html).toContain("Brodo (demo) · 20 porzioni · non valorizzato");
      expect(html).not.toMatch(/Brodo[^<]*0,00/);
    });

    it("a valued line that holds unvalued operations shows the amount and how many are missing", () => {
      const data = combined();
      data.reasons![0]!.batchLines[0] = {
        recipeKey: KEY,
        recipeName: "Ragù (demo)",
        portions: 6,
        valueEur: 10,
        unvaluedCount: 2,
      };
      const html = render(data);
      expect(html).toMatch(/Ragù \(demo\) · 6 porzioni · 10,00\s€ \(\+2 non valorizzate\)/);
      data.reasons![0]!.batchLines[0]!.unvaluedCount = 1;
      expect(render(data)).toMatch(/Ragù \(demo\) · 6 porzioni · 10,00\s€ \(\+1 non valorizzata\)/);
    });

    it("a line without a value is 'non valorizzato' and never adds the suffix or 0,00 €", () => {
      const html = render(combined());
      expect(html).toContain("Brodo (demo) · 20 porzioni · non valorizzato</p>");
      expect(html).not.toContain("(+");
      expect(html).not.toMatch(/Brodo[^<]*0,00/);
    });

    it("counts the unvalued operations, batch ones included", () => {
      expect(render(combined())).toMatch(
        /<dt[^>]*>Movimenti senza prezzo<\/dt><dd[^>]*class="num[^"]*"[^>]*>1<\/dd>/,
      );
    });

    it("escapes markup in a recipe name", () => {
      const data = combined();
      data.reasons![0]!.batchLines[0]!.recipeName = "<script>x</script>";
      const html = render(data);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });
});
