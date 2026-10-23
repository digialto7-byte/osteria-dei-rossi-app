import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecipeFacts } from "@/app/(owner)/ricette/[key]/recipe-facts";
import { BATCH, PLATE } from "./recipe-fixtures";

const render = (recipe = BATCH, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(RecipeFacts, { recipe, ...props } as never));

describe("RecipeFacts", () => {
  it("shows the batch facts from the API values, quantities in .num", () => {
    const html = render();
    for (const [label, value] of [
      ["Resa del lotto", "6 kg"],
      ["Porzioni", "30"],
      ["Porzione", "0,2 kg"],
      ["Conservazione", "72 ore"],
      ["Preparazione", "180 min"],
      ["Porzioni minime", "5"],
      ["Porzioni obiettivo", "30"],
    ]) {
      expect(html).toMatch(
        new RegExp(`<dt[^>]*>${label}</dt>\\s*<dd[^>]*class="[^"]*num[^"]*"[^>]*>${value}</dd>`),
      );
    }
    expect(html).toContain("Lotto");
    expect(html).toContain("v3");
  });

  it("a batch has no price rows at all", () => {
    expect(render()).not.toMatch(/Prezzo|GP obiettivo/);
  });

  it("shows the menu price as 1.234,50 € style and the target GP% when pricing exists", () => {
    const html = render(PLATE);
    expect(html).toMatch(
      /Prezzo di vendita \(IVA inclusa\)<\/dt>\s*<dd[^>]*num[^>]*>12,00 €<\/dd>/,
    );
    expect(html).toMatch(/GP obiettivo<\/dt>\s*<dd[^>]*num[^>]*>70%<\/dd>/);
  });

  it("the chef reads both price fields (Q16 = V6) and sees no cost or margin", () => {
    const chefView = { ...PLATE, canEditPrice: false, canDeactivate: false };
    const html = render(chefView);
    expect(html).toContain("12,00");
    expect(html).toContain("70%");
    expect(html).not.toMatch(/costo|margine|cost|margin/i);
  });

  it("a plate without a stored price shows a dash instead of an invented number", () => {
    const html = render({ ...PLATE, pricing: { salePrice: null, targetGpPct: null } });
    expect(html).toMatch(/Prezzo di vendita \(IVA inclusa\)<\/dt>\s*<dd[^>]*>—<\/dd>/);
  });

  it("omits the facts a recipe does not have", () => {
    const html = render(PLATE);
    expect(html).not.toMatch(/Resa del lotto|Conservazione|Preparazione|Porzioni minime/);
  });

  it("a sub-recipe's output is labelled 'Resa'", () => {
    const html = render({
      ...BATCH,
      type: "sub",
      portionsPerBatch: null,
      portionSize: null,
      shelfLifeHours: null,
    });
    expect(html).toMatch(/<dt[^>]*>Resa<\/dt>/);
  });

  it("the read-only variant says the version is not editable and has no button", () => {
    const html = render(BATCH, { readOnly: { total: 3 } });
    expect(html).toContain("Versione 3 di 3 — non modificabile");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });

  it("escapes values from the API", () => {
    const html = render({ ...BATCH, name: "<b>x</b>" });
    expect(html).not.toContain("<b>x</b>");
  });
});
