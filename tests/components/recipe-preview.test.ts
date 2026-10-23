import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  INITIAL_DRY_RUN,
  RecipePreview,
  RecipeImportOptions,
} from "@/app/(owner)/anagrafiche/importa/recipe-preview";
import { messages, t } from "@/lib/i18n";
import type { RecipeImportResult } from "@/server/recipes/import";

const RESULT: RecipeImportResult = {
  dryRun: true,
  created: 1,
  newVersions: 1,
  unchanged: 1,
  recipes: [
    { row: 2, name: "Polenta (demo)", action: "create", version: 1, warnings: [] },
    {
      row: 3,
      name: "Spezzatino (demo)",
      action: "new_version",
      version: 3,
      warnings: [{ line: 2, code: "yield_above_one" }],
    },
    {
      row: 4,
      name: "Spezzatino con polenta (demo)",
      action: "unchanged",
      version: 1,
      warnings: [],
    },
  ],
};

const preview = (result = RESULT, props = {}) =>
  renderToStaticMarkup(
    createElement(RecipePreview, {
      result,
      busy: false,
      onConfirm: () => undefined,
      ...props,
    } as never),
  );

describe("RecipePreview", () => {
  it("words each action: Nuova, Nuova versione (v3), Invariata", () => {
    const html = preview();
    expect(html).toContain("Nuova<");
    expect(html).toContain("Nuova versione (v3)");
    expect(html).toContain("Invariata");
    expect(html).not.toMatch(/create|new_version|unchanged/);
  });

  it("lists the recipe names and escapes them", () => {
    expect(preview()).toContain("Spezzatino con polenta (demo)");
    const html = preview({
      ...RESULT,
      recipes: [{ ...RESULT.recipes[0]!, name: "<script>x</script>" }],
    });
    expect(html).not.toContain("<script>");
  });

  it("lists the warnings as text", () => {
    expect(preview()).toContain("Riga 2: resa superiore a 1");
  });

  it("a preview says nothing was saved and offers one primary 'Importa'", () => {
    const html = preview();
    expect(html).toContain("Non è stato salvato nulla.");
    expect(html.match(/bg-accent text-on-accent/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*>Importa<\/button>/);
    expect(html).toContain("1 nuove, 1 nuove versioni, 1 invariate");
  });

  it("a real import shows the counts and no button", () => {
    const html = preview({ ...RESULT, dryRun: false });
    expect(html).toContain("Ricette importate: 1 nuove, 1 nuove versioni, 1 invariate");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Non è stato salvato nulla.");
    expect(html).toMatch(/role="status"/);
    expect(preview()).not.toMatch(/role="status"/);
  });
});

describe("RecipeImportOptions", () => {
  it("'Solo anteprima' is checked by default, so nothing is saved by accident", () => {
    expect(INITIAL_DRY_RUN).toBe(true);
    const html = renderToStaticMarkup(
      createElement(RecipeImportOptions, { dryRun: INITIAL_DRY_RUN, onChange: () => undefined }),
    );
    expect(html).toMatch(
      /<input[^>]*type="checkbox"[^>]*checked=""|<input[^>]*checked=""[^>]*type="checkbox"/,
    );
    expect(html).toContain("Solo anteprima");
  });
});

describe("ingredient allergen help text", () => {
  it("names «nessuno» and «-» and says an import never confirms", () => {
    const text = t("import.allergensRule");
    expect(text).toContain("«nessuno»");
    expect(text).toContain("«-»");
    expect(text).toContain("da indicare");
    expect(text).toContain("non conferma mai");
    expect(messages.en["import.allergensRule"]).toContain("never confirms");
  });
});
