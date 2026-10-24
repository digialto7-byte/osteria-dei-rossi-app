import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MenuItemForm } from "@/app/(owner)/menu/menu-item-form";
import { emptyMenuForm, formFromItem } from "@/lib/menu/menu-form";
import { IDS, MANAGE_MENU, MAPPED_ITEM } from "../helpers/menu-tables-data";

type Props = Parameters<typeof MenuItemForm>[0];
const RECIPES = [
  { key: IDS.recipeKey, name: "Spezzatino con polenta (demo)" },
  { key: "ec000000-0000-4000-8000-0000000000e2", name: "Tagliata (demo)" },
];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(MenuItemForm, {
      mode: "create",
      initial: emptyMenuForm(10),
      recipes: RECIPES,
      vatRates: MANAGE_MENU.vatRates,
      courses: MANAGE_MENU.courses,
      categories: MANAGE_MENU.categories,
      busy: false,
      error: null,
      errors: {},
      onSubmit: () => undefined,
      onCancel: () => undefined,
      ...over,
    }),
  );

describe("MenuItemForm, new dish", () => {
  it("has the fields: Nome, Categoria with a datalist of the categories, Portata, Ricetta, Prezzo, Aliquota IVA, Ordine", () => {
    const html = render();
    for (const label of [
      "Nome",
      "Categoria",
      "Portata",
      "Ricetta",
      "Prezzo (IVA inclusa)",
      "Aliquota IVA",
      "Ordine",
      "Disponibile",
    ]) {
      expect(html, label).toContain(label);
    }
    expect(html).toMatch(/<input[^>]*list="[^"]+"/);
    expect(html).toMatch(
      /<datalist[^>]*><option value="Bevande"><\/option><option value="Secondi"><\/option><\/datalist>/,
    );
  });

  it("Portata is a select of the five courses in service order, with their words", () => {
    const html = render();
    const select = /<select[^>]*name="course"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    const options = [...select.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)</g)];
    expect(options.map((m) => m[1])).toEqual(["antipasti", "primi", "secondi", "dolci", "bevande"]);
    expect(options.map((m) => m[2])).toEqual(["Antipasti", "Primi", "Secondi", "Dolci", "Bevande"]);
  });

  it("Ricetta starts with 'Nessuna ricetta' (selected) and lists the plates", () => {
    const html = render();
    const select = /<select[^>]*name="recipe"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(select).toMatch(/^<option[^>]*value=""[^>]*selected[^>]*>Nessuna ricetta<\/option>/);
    expect(select).toContain("Spezzatino con polenta (demo)");
    expect(select).toContain("Tagliata (demo)");
  });

  it("Prezzo is a decimal field and the VAT rate is pre-selected from the default", () => {
    const html = render();
    expect(html).toMatch(
      /<input[^>]*name="price"[^>]*inputMode="decimal"|<input[^>]*inputMode="decimal"[^>]*name="price"/,
    );
    const select = /<select[^>]*name="vatRate"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(select).toMatch(/<option[^>]*value="10"[^>]*selected[^>]*>10 %<\/option>/);
    expect(select.match(/<option/g)).toHaveLength(5);
  });

  it("without a default rate the select asks to choose one", () => {
    const html = render({ initial: emptyMenuForm(null) });
    expect(html).toMatch(/<option[^>]*value=""[^>]*selected[^>]*>Scegli l&#x27;aliquota<\/option>/);
  });

  it("has no Attivo switch for a new dish, a primary Salva and a quiet Annulla", () => {
    const html = render();
    expect(html).not.toContain("Attivo");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Salva<\/button>/);
    expect(html).toMatch(/<button[^>]*>Annulla<\/button>/);
  });

  it("shows the field errors and the form error", () => {
    const html = render({
      errors: { price: "Prezzo non valido." },
      error: "Esiste già un piatto con questo nome.",
    });
    expect(html).toContain("Prezzo non valido.");
    expect(html).toContain("Esiste già un piatto con questo nome.");
    expect(html).toMatch(
      /<input[^>]*name="price"[^>]*aria-invalid="true"|<input[^>]*aria-invalid="true"[^>]*name="price"/,
    );
  });
});

describe("MenuItemForm, edit", () => {
  it("is filled with the item and adds Attivo", () => {
    const html = render({ mode: "edit", initial: formFromItem(MAPPED_ITEM) });
    expect(html).toContain("Attivo");
    expect(html).toMatch(
      /<input[^>]*name="name"[^>]*value="Spezzatino con polenta \(demo\)"|<input[^>]*value="Spezzatino con polenta \(demo\)"[^>]*name="name"/,
    );
    expect(html).toContain('value="14,00"');
    const recipe = /<select[^>]*name="recipe"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(recipe).toMatch(new RegExp(`<option[^>]*value="${IDS.recipeKey}"[^>]*selected`));
  });

  it("keeps a recipe that is no longer in the list of plates (deactivated) as an option", () => {
    const html = render({
      mode: "edit",
      initial: formFromItem(MAPPED_ITEM),
      recipes: [RECIPES[1]!],
      currentRecipe: { key: IDS.recipeKey, name: "Spezzatino con polenta (demo)" },
    });
    const recipe = /<select[^>]*name="recipe"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(recipe).toContain(IDS.recipeKey);
  });

  it("disables the buttons while saving", () => {
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled[^>]*>Salva<\/button>/);
  });
});
