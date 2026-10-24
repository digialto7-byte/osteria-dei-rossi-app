import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductionForm } from "@/app/(owner)/produzione/nuova/production-form";
import type { BatchProposal } from "@/server/batches/types";
import { CELLA, DISPENSA, KEY, PROPOSAL, WATER } from "./batch-fixtures";

const RECIPES = [
  { key: KEY, name: "Spezzatino (demo)" },
  { key: "ec000000-0000-4000-8000-0000000000e2", name: "Brodo (demo)" },
];

const render = (
  props: Partial<{
    proposal: BatchProposal | null;
    error: string | null;
    errorIngredientIds: string[];
  }> = {},
) =>
  renderToStaticMarkup(
    createElement(ProductionForm, {
      recipes: RECIPES,
      proposal: PROPOSAL,
      busy: false,
      error: null,
      errorIngredientIds: [],
      onCalculate: () => {},
      onShelfLife: () => {},
      onSubmit: () => {},
      ...props,
    }),
  );

describe("ProductionForm", () => {
  it("has four labelled sections", () => {
    const html = render();
    for (const title of ["Ricetta", "Quantità prodotta", "Ingredienti usati", "Lotto prodotto"]) {
      expect(html, title).toMatch(new RegExp(`<h2[^>]*>${title}</h2>`));
    }
    expect([...html.matchAll(/<section/g)]).toHaveLength(4);
  });

  it("offers the batch recipes, the recipe output and a Calcola button", () => {
    const html = render();
    expect(html).toContain("Spezzatino (demo)");
    expect(html).toContain("Brodo (demo)");
    expect(html).toMatch(/<input[^>]*inputMode="decimal"[^>]*value="6,2"/);
    expect(html).toMatch(/<button[^>]*>Calcola<\/button>/);
  });

  it('prefills "Porzioni" with 31 and says how it was computed', () => {
    const html = render();
    expect(html).toMatch(/<input[^>]*inputMode="numeric"[^>]*value="31"/);
    expect(html).toContain("Calcolate: 31 (0,2 kg a porzione, arrotondate per difetto)");
  });

  it("has exactly one primary button, Registra produzione", () => {
    const html = render();
    const primary = [...html.matchAll(/<button[^>]*type="submit"[^>]*>([^<]*)<\/button>/g)];
    expect(primary.map((m) => m[1])).toEqual(["Registra produzione"]);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*bg-accent|<button[^>]*type="submit"/);
  });

  it("shows one block per ingredient in the server's order, the water as not in stock", () => {
    const html = render();
    expect(html.indexOf("Manzo muscolo (demo)")).toBeLessThan(html.indexOf("Acqua (demo)"));
    expect(html).toContain("Non a magazzino: non viene scaricato");
  });

  it("shows the server's use-by preview as given, with no date arithmetic", () => {
    expect(render()).toContain("Da consumare entro il 26/10/2026, 10:12 (indicativo)");
    // An inconsistent preview (not 72 h after anything) is shown exactly as the server sent it.
    const odd = { ...PROPOSAL, useByPreview: "2027-01-02T08:30:00+00:00" };
    expect(render({ proposal: odd })).toContain(
      "Da consumare entro il 02/01/2027, 09:30 (indicativo)",
    );
  });

  it("shows the location of the batch only with two or more locations", () => {
    expect(render()).not.toContain("Ubicazione del lotto");
    const two = {
      ...PROPOSAL,
      suggestedLocationId: null,
      locations: [
        { id: CELLA, name: "Cella (demo)" },
        { id: DISPENSA, name: "Dispensa (demo)" },
      ],
    };
    expect(render({ proposal: two })).toContain("Ubicazione del lotto");
  });

  it.each([
    ["La ricetta è stata modificata: ricalcola la proposta."],
    ["Il lotto scelto è vuoto in questa ubicazione."],
    ["Indica almeno un ingrediente usato."],
  ])("shows the error %s above the button", (message) => {
    const html = render({ error: message });
    expect(html).toContain(message);
    expect(html.indexOf(message)).toBeLessThan(html.indexOf("Registra produzione"));
    expect(html).toMatch(/role="alert"/);
  });

  it("passes the error to the ingredient it names", () => {
    const html = render({
      error: "Il lotto scelto è vuoto in questa ubicazione.",
      errorIngredientIds: [PROPOSAL.inputs[0]!.ingredientId],
    });
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(html).not.toContain(`id="${WATER}`);
  });

  it("without a proposal only the first two sections are usable", () => {
    const html = render({ proposal: null });
    expect(html).toContain("Calcola la proposta per continuare.");
    expect(html).not.toContain("Registra produzione");
  });

  it("never shows a euro sign", () => {
    expect(render()).not.toContain("€");
    expect(
      render({ error: "Gli ingredienti non corrispondono alla ricetta: ricalcola la proposta." }),
    ).not.toContain("€");
  });
});
