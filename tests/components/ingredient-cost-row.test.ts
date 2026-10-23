import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IngredientCostRow } from "@/app/(owner)/costi/ingredienti/ingredient-cost-row";
import type { IngredientCost } from "@/server/costing/types";
import { BEEF, plainHtml } from "./cost-fixtures";

const render = (ingredient: IngredientCost, busy = false) =>
  plainHtml(
    renderToStaticMarkup(
      createElement(
        "ul",
        null,
        createElement(IngredientCostRow, {
          ingredient,
          avgCostN: 3,
          busy,
          onSwitch: () => undefined,
        }),
      ),
    ),
  );

describe("IngredientCostRow", () => {
  it("words the basis, the prices and the purchases", () => {
    const html = render(BEEF);
    expect(html).toContain("Media ultimi 3 acquisti");
    expect(html).toContain(
      "In uso 10,00 €/kg · media 10,00 € · ultimo 11,00 € · massimo 11,00 € · 3 acquisti, ultimo il 20/10/2026",
    );
  });

  it("with the last price in use the badge says so and the button offers the average", () => {
    const html = render({ ...BEEF, basis: "last_price" });
    expect(html).toContain("Ultimo prezzo");
    expect(html).toContain("Usa la media");
    expect(html).not.toContain("Usa ultimo prezzo");
  });

  it("the button label flips with the basis", () => {
    expect(render(BEEF)).toContain("Usa ultimo prezzo");
  });

  it("the button is described by the row's name", () => {
    const html = render(BEEF);
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toMatch(/<button[^>]*aria-describedby/);
  });

  it("never bought: 'Nessun acquisto' and no 0,00 €", () => {
    const html = render({
      ...BEEF,
      unitCostEur: null,
      avgEur: null,
      lastEur: null,
      maxEur: null,
      purchasesUsed: 0,
      lastPurchaseOn: null,
    });
    expect(html).toContain("Nessun acquisto");
    expect(html).not.toContain("0,00");
    expect(html).not.toContain("In uso");
  });

  it("disables the button while a change is being saved", () => {
    expect(render(BEEF, true)).toMatch(/<button[^>]*disabled/);
  });
});
