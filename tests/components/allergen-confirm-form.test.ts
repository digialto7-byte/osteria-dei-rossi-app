import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AllergenCell,
  AllergenConfirmForm,
} from "@/app/(owner)/anagrafiche/ingredienti/allergen-confirm-form";
import { ALLERGENS } from "@/server/master/ingredients";

const ingredient = (over: Record<string, unknown> = {}) => ({
  id: "2b",
  name: "Farina di mais (demo)",
  allergens: null,
  allergenStatus: "unknown" as const,
  allergensConfirmedAt: null,
  ...over,
});

const form = (allergens: string[] | null = ["glutine", "latte"], props = {}) =>
  renderToStaticMarkup(
    createElement(AllergenConfirmForm, {
      ingredient: ingredient({ allergens }),
      busy: false,
      error: null,
      onSubmit: () => undefined,
      onCancel: () => undefined,
      ...props,
    } as never),
  );
const cell = (over = {}, canConfirm = true) =>
  renderToStaticMarkup(
    createElement(AllergenCell, {
      ingredient: ingredient(over),
      canConfirm,
      onConfirm: () => undefined,
    } as never),
  );

describe("AllergenConfirmForm", () => {
  it("has 14 labelled checkboxes, one per EU allergen, in words", () => {
    const html = form();
    expect(html.match(/type="checkbox"/g)).toHaveLength(ALLERGENS.length);
    expect(ALLERGENS).toHaveLength(14);
    expect(html.replace(/<label[\s\S]*?<\/label>/g, "")).not.toContain("<input");
    for (const word of ["Glutine", "Frutta a guscio", "Molluschi", "Lupini"])
      expect(html).toContain(word);
  });

  it("prefills the boxes from the declared list and nothing else", () => {
    const html = form(["glutine", "latte"]);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toMatch(
      /checked=""[^>]*\/>\s*<span>Glutine<\/span>|<input[^>]*checked=""[^>]*\/><span>Glutine/,
    );
    expect(form(null).match(/checked=""/g)).toBeNull();
  });

  it("has one primary button, 'Conferma', and the supplier-label hint", () => {
    const html = form();
    expect(html.match(/bg-accent text-on-accent/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Conferma</);
    expect(html).toContain("Controlla le etichette dei fornitori prima di confermare.");
    expect(html).toContain("non contiene allergeni");
  });

  it("names the ingredient in the legend and shows an error next to the form", () => {
    const html = form(["latte"], { error: "Operazione non consentita per il tuo ruolo." });
    expect(html).toMatch(/<legend[^>]*>Allergeni di Farina di mais \(demo\)</);
    expect(html).toMatch(/role="alert"[^>]*>Operazione non consentita/);
  });

  it("disables the submit while busy", () => {
    expect(form(["latte"], { busy: true })).toMatch(/disabled=""/);
  });
});

describe("AllergenCell", () => {
  it("an unknown list reads 'Non indicati' with a 'da confermare' badge, never 'Nessuno'", () => {
    const html = cell();
    expect(html).toContain("Non indicati");
    expect(html).not.toContain("Nessuno");
    expect(html).toMatch(/bg-warning-bg[^>]*>[\s\S]*da confermare/);
  });

  it("a declared none reads 'Nessuno' and still waits for confirmation", () => {
    const html = cell({ allergens: [], allergenStatus: "declared" });
    expect(html).toContain("Nessuno");
    expect(html).toContain("da confermare");
  });

  it("a declared list names the allergens", () => {
    expect(cell({ allergens: ["glutine"], allergenStatus: "declared" })).toContain("Glutine");
  });

  it("a confirmed list shows when, in Europe/Rome, and no badge and no button", () => {
    const html = cell({
      allergens: ["latte"],
      allergenStatus: "confirmed",
      allergensConfirmedAt: "2026-10-23T10:00:00+00:00",
    });
    expect(html).toMatch(/class="num[^"]*"[^>]*>Confermati il 23\/10\/2026</);
    expect(html).not.toContain("da confermare");
    expect(html).not.toContain("<button");
  });

  it("the owner gets a secondary 'Conferma allergeni' button for an unconfirmed list", () => {
    const html = cell();
    expect(html).toMatch(/<button[^>]*border-ink[^>]*>Conferma allergeni<\/button>/);
    expect(html).not.toMatch(/bg-accent/);
  });

  it("renders no button when the caller cannot confirm (admin, chef)", () => {
    const html = cell({}, false);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Conferma allergeni");
    expect(html).toContain("da confermare");
  });
});
