import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecipeForm } from "@/app/(owner)/ricette/recipe-form";
import { emptyForm } from "@/lib/recipes/recipe-form";
import type { RecipeType } from "@/server/recipes/types";

const ingredients = [{ id: "i1", name: "Manzo muscolo (demo)" }];
const recipes = [
  { key: "s1", name: "Polenta (demo)", type: "sub" as const },
  { key: "b1", name: "Spezzatino (demo)", type: "batch" as const },
  { key: "p1", name: "Piatto (demo)", type: "plate" as const },
];

const render = (type: RecipeType, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(RecipeForm, {
      type,
      state: emptyForm(type),
      onChange: () => undefined,
      ingredients,
      recipes,
      canEditPrice: false,
      errors: {},
      summary: null,
      busy: false,
      submitLabel: "Salva versione",
      onSubmit: () => undefined,
      onCancel: () => undefined,
      ...props,
    } as never),
  );

const outsideLabels = (html: string) => html.replace(/<label[\s\S]*?<\/label>/g, "");

describe("RecipeForm", () => {
  it("every input and select sits inside a Field label", () => {
    for (const type of ["batch", "plate", "sub"] as const) {
      const html = render(type, { canEditPrice: true });
      expect(outsideLabels(html)).not.toMatch(/<(input|select|textarea)\b/);
    }
  });

  it("a batch shows portions and shelf life, a plate does not", () => {
    const batch = render("batch");
    expect(batch).toContain("Porzioni per lotto");
    expect(batch).toContain("Conservazione (ore)");
    const plate = render("plate");
    expect(plate).not.toContain("Porzioni per lotto");
    expect(plate).not.toContain("Conservazione (ore)");
    expect(plate).not.toContain("Quantità prodotta");
  });

  it("price fields appear only for a plate and only when the caller can edit the price", () => {
    expect(render("plate", { canEditPrice: true })).toContain("Prezzo di vendita (IVA inclusa, €)");
    expect(render("plate", { canEditPrice: true })).toContain("GP obiettivo (%)");
    const chef = render("plate", { canEditPrice: false });
    expect(chef).not.toMatch(/Prezzo|GP obiettivo/);
    expect(render("batch", { canEditPrice: true })).not.toContain("Prezzo");
  });

  it("has exactly one primary button, the submit, and a quiet cancel", () => {
    const html = render("batch");
    expect(html.match(/bg-accent text-on-accent/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Salva versione</);
    expect(html).toMatch(/<button[^>]*>Annulla</);
  });

  it("the line editor uses bordered rows, not cards", () => {
    const html = render("batch");
    expect(html).toContain("Ingrediente o ricetta");
    expect(html).toMatch(/Resa/);
    expect(html).toContain("1 = nessuna perdita; 0,82 = 18 % di scarto");
    expect(html).not.toContain("rounded-card");
  });

  it("quantity and yield are decimal text inputs", () => {
    const html = render("batch");
    expect(html).toMatch(/inputMode="decimal"/);
  });

  it("offers ingredients and the recipes a type may use, never a plate, never itself", () => {
    const forPlate = render("plate");
    expect(forPlate).toContain("Manzo muscolo (demo)");
    expect(forPlate).toContain("Polenta (demo)");
    expect(forPlate).toContain("Spezzatino (demo)");
    expect(forPlate).not.toContain("Piatto (demo)");
    const forBatch = render("batch");
    expect(forBatch).toContain("Polenta (demo)");
    expect(forBatch).not.toContain("Spezzatino (demo)");
    expect(render("sub", { selfKey: "s1" })).not.toContain("Polenta (demo)");
  });

  it("shows server and client field errors next to the field, and the summary as an alert", () => {
    const html = render("batch", {
      errors: {
        "lines.0.yieldFactor": "La resa deve essere maggiore di 0.",
        name: "valore obbligatorio",
      },
      summary: "La ricetta contiene valori non validi.",
    });
    expect(html).toContain("La resa deve essere maggiore di 0.");
    expect(html).toContain("valore obbligatorio");
    expect(html).toMatch(/role="alert"[^>]*>La ricetta contiene valori non validi\./);
  });

  it("the type picker is there only when asked for (a new recipe)", () => {
    expect(render("batch")).not.toContain("Tipo di ricetta");
    expect(
      render("batch", { typePicker: { value: "batch", onChange: () => undefined } }),
    ).toContain("Tipo di ricetta");
  });

  it("offers a reload when a stale version was reported", () => {
    expect(render("batch", { onReload: () => undefined })).toContain("Ricarica");
    expect(render("batch")).not.toContain("Ricarica");
  });

  it("disables the submit while busy", () => {
    expect(render("batch", { busy: true })).toMatch(
      /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/,
    );
  });
});
