import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecipeRow } from "@/app/(owner)/ricette/recipe-row";
import { SUMMARY } from "./recipe-fixtures";

const render = (over: Partial<typeof SUMMARY> = {}) =>
  renderToStaticMarkup(
    createElement("ul", null, createElement(RecipeRow, { recipe: { ...SUMMARY, ...over } })),
  );

describe("RecipeRow", () => {
  it("links the bold name to the recipe and shows the type as a word in a badge", () => {
    const html = render();
    expect(html).toContain(`href="/ricette/${SUMMARY.key}"`);
    expect(html).toMatch(/<[^>]*font-bold[^>]*>Spezzatino \(demo\)</);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><\/span>Lotto</);
  });

  it("puts the version and the date in a .num meta line", () => {
    expect(render()).toMatch(/<p class="num[^"]*"[^>]*>v3 · dal 23\/10\/2026<\/p>/);
  });

  it("shows 'Allergeni da confermare' as a warning badge with the words, only when unconfirmed", () => {
    const todo = render({
      allergens: { list: [], status: "da_confermare", unconfirmedIngredients: [] },
    });
    expect(todo).toMatch(/bg-warning-bg[^>]*>[\s\S]*Allergeni da confermare/);
    expect(render()).not.toContain("Allergeni da confermare");
  });

  it("marks a deactivated recipe in words", () => {
    expect(render({ isActive: false })).toContain("disattivata");
    expect(render()).not.toContain("disattivata");
  });

  it("escapes a name that contains markup", () => {
    const html = render({ name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
