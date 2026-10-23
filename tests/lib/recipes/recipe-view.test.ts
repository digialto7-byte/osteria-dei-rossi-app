import { describe, expect, it } from "vitest";
import {
  TYPE_FILTERS,
  allergenWords,
  canEditRecipePrice,
  canReadRecipes,
  fieldErrorText,
  hoursText,
  lineQuantity,
  lineWarningText,
  minutesText,
  percentText,
  recipeErrorText,
  recipeDate,
  recipeMeta,
  typeLabel,
  unconfirmedLine,
  yieldText,
} from "@/lib/recipes/recipe-view";

describe("labels", () => {
  it("words the types, in both languages", () => {
    expect(typeLabel("batch")).toBe("Lotto");
    expect(typeLabel("plate")).toBe("Piatto");
    expect(typeLabel("sub")).toBe("Sottoricetta");
    expect(typeLabel("plate", "en")).toBe("Plate");
  });

  it("offers the four filters in order", () => {
    expect(TYPE_FILTERS).toEqual(["all", "batch", "plate", "sub"]);
  });

  it("writes the version and the Europe/Rome date of a version", () => {
    expect(recipeMeta(3, "2026-10-23T10:00:00+00:00")).toBe("v3 · dal 23/10/2026");
    // 23:30 UTC is already the next day in Rome (CEST, UTC+2 until 25 October, then UTC+1).
    expect(recipeMeta(1, "2026-10-23T23:30:00+00:00")).toBe("v1 · dal 24/10/2026");
    expect(recipeMeta(1, "2026-12-31T23:30:00+00:00")).toBe("v1 · dal 01/01/2027");
  });

  it("writes the Europe/Rome date alone", () => {
    expect(recipeDate("2026-10-23T10:00:00+00:00")).toBe("23/10/2026");
    expect(recipeDate("2026-10-23T22:30:00+00:00", "en")).toBe("24/10/2026");
  });

  it("writes quantities with the decimal comma and a non-breaking space", () => {
    expect(lineQuantity(5, "kg")).toBe("5 kg");
    expect(lineQuantity(0.2, "kg")).toBe("0,2 kg");
    expect(lineQuantity(1, "porz")).toBe("1 porz");
    expect(lineQuantity(1234.5, "g")).toBe("1.234,5 g");
  });

  it("writes the yield, the hours, the minutes and a percentage", () => {
    expect(yieldText(0.82)).toBe("resa 0,82");
    expect(yieldText(1)).toBe("resa 1");
    expect(hoursText(72)).toBe("72 ore");
    expect(minutesText(180)).toBe("180 min");
    expect(percentText(70)).toBe("70%");
    expect(percentText(33.5)).toBe("33,5%");
  });

  it("explains a yield warning with the line number", () => {
    expect(lineWarningText(2, "yield_above_one")).toBe(
      "Riga 2: resa superiore a 1 (aumento di peso in cottura).",
    );
  });
});

describe("allergen words", () => {
  const summary = (list: string[], names: string[] = []) =>
    ({
      list,
      status: names.length ? "da_confermare" : "confirmed",
      unconfirmedIngredients: names.map((name, i) => ({ id: `i${i}`, name })),
    }) as never;

  it("names each allergen as a word, or says none were declared", () => {
    expect(allergenWords(summary(["glutine", "frutta_a_guscio"]))).toBe("Glutine, Frutta a guscio");
    expect(allergenWords(summary([]))).toBe("Nessun allergene dichiarato");
  });

  it("lists what is still to confirm, or nothing when all is confirmed", () => {
    expect(unconfirmedLine(summary([], ["Farina di mais (demo)", "Pane (demo)"]))).toBe(
      "Da confermare: Farina di mais (demo), Pane (demo)",
    );
    expect(unconfirmedLine(summary([]))).toBeNull();
  });
});

describe("roles", () => {
  it("owner, admin and chef read recipes; the waiter and an unknown role do not", () => {
    for (const role of ["owner", "admin", "chef"]) expect(canReadRecipes(role)).toBe(true);
    for (const role of ["waiter", "", "x"]) expect(canReadRecipes(role)).toBe(false);
  });

  it("only owner and admin set the price", () => {
    expect(canEditRecipePrice("owner")).toBe(true);
    expect(canEditRecipePrice("admin")).toBe(true);
    expect(canEditRecipePrice("chef")).toBe(false);
    expect(canEditRecipePrice("waiter")).toBe(false);
  });
});

describe("error texts (plan §3.7)", () => {
  it.each([
    [
      "version_conflict",
      "Nel frattempo è stata salvata la versione 3. Ricarica e rifai la modifica.",
    ],
    [
      "recipe_cycle",
      "Questa sottoricetta usa già, direttamente o indirettamente, la ricetta che stai modificando.",
    ],
    ["yield_factor_not_positive", "La resa deve essere maggiore di 0."],
    ["yield_factor_too_large", "Resa troppo alta: scrivi 0,82, non 82."],
    ["incompatible_units", "Unità non compatibile con l'ingrediente."],
    ["line_target_not_allowed", "Un lotto si usa solo in un piatto, a porzioni."],
    ["recipe_price_forbidden", "Prezzo e GP obiettivo li modifica il titolare."],
    ["recipe_unchanged", "Nessuna modifica da salvare."],
    ["recipe_name_taken", "Esiste già una ricetta con questo nome."],
  ])("%s", (code, text) => {
    expect(recipeErrorText(code, [{ currentVersion: 3 }])).toBe(text);
  });

  it("a version conflict without a number still reads well", () => {
    expect(recipeErrorText("version_conflict")).toContain("nuova versione");
  });

  it("is null for a code it does not know, so the screen falls back to the server text", () => {
    expect(recipeErrorText("something_new")).toBeNull();
  });

  it("words a field problem by its code and falls back to the code itself", () => {
    expect(
      fieldErrorText({ field: "lines.0.yieldFactor", code: "yield_factor_not_positive" }),
    ).toBe("La resa deve essere maggiore di 0.");
    expect(fieldErrorText({ field: "name", code: "required" })).toBe("valore obbligatorio");
    expect(fieldErrorText({ field: "x", code: "brand_new" })).toBe("brand_new");
  });

  it("speaks English as the second locale", () => {
    expect(recipeErrorText("recipe_unchanged", undefined, "en")).toBe("There is nothing to save.");
  });
});
