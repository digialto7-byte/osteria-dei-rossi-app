import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllergenPanel } from "@/app/(owner)/ricette/[key]/allergen-panel";
import type { AllergenSummary } from "@/server/recipes/types";

const TODO: AllergenSummary = {
  list: ["glutine", "frutta_a_guscio"],
  status: "da_confermare",
  unconfirmedIngredients: [{ id: "2b", name: "Farina di mais (demo)" }],
};
const DONE: AllergenSummary = { list: [], status: "confirmed", unconfirmedIngredients: [] };

const render = (allergens: AllergenSummary, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(AllergenPanel, { allergens, canLink: false, ...props }));

describe("AllergenPanel", () => {
  it("names the allergens in words and warns 'da confermare' with the ingredient", () => {
    const html = render(TODO);
    expect(html).toContain("Glutine, Frutta a guscio");
    expect(html).toMatch(/bg-warning-bg[^>]*>[\s\S]*da confermare/);
    expect(html).toContain("Da confermare: Farina di mais (demo)");
  });

  it("confirmed with no allergens says so in words and shows no warning", () => {
    const html = render(DONE);
    expect(html).toContain("Nessun allergene dichiarato");
    expect(html).not.toContain("da confermare");
    expect(html).not.toContain("bg-warning-bg");
  });

  it("an unconfirmed recipe with an empty list never reads as allergen-free alone", () => {
    const html = render({ list: [], status: "da_confermare", unconfirmedIngredients: [] });
    expect(html).toContain("da confermare");
  });

  it("links the unconfirmed ingredients to their page for owner and admin only", () => {
    expect(render(TODO, { canLink: true })).toContain(
      'href="/anagrafiche/ingredienti#ingredient-2b"',
    );
    expect(render(TODO)).not.toContain("<a ");
  });

  it("says a past version is shown with today's data", () => {
    expect(render(DONE, { historical: true })).toContain("Allergeni secondo i dati attuali");
    expect(render(DONE)).not.toContain("Allergeni secondo i dati attuali");
  });

  it("escapes ingredient names", () => {
    const html = render({
      ...TODO,
      unconfirmedIngredients: [{ id: "x", name: "<img src=x onerror=alert(1)>" }],
    });
    expect(html).not.toContain("<img");
  });
});
