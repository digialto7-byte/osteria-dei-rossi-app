import { describe, expect, it } from "vitest";
import {
  allergenCellText,
  canConfirmAllergens,
  confirmedOnText,
  needsConfirmation,
} from "@/lib/ingredients/allergen-view";

describe("allergenCellText", () => {
  it("says 'Non indicati' for an unknown list, never 'Nessuno'", () => {
    expect(allergenCellText(null)).toBe("Non indicati");
  });

  it("says 'Nessuno' only for a declared empty list", () => {
    expect(allergenCellText([])).toBe("Nessuno");
  });

  it("names the allergens in words", () => {
    expect(allergenCellText(["glutine", "frutta_a_guscio"])).toBe("Glutine, Frutta a guscio");
    expect(allergenCellText(["latte"], "en")).toBe("Milk");
  });
});

describe("needsConfirmation", () => {
  it("unknown and declared lists wait for a confirmation; a confirmed one does not", () => {
    expect(needsConfirmation("unknown")).toBe(true);
    expect(needsConfirmation("declared")).toBe(true);
    expect(needsConfirmation("confirmed")).toBe(false);
  });
});

describe("confirmedOnText", () => {
  it("writes the Europe/Rome date of the confirmation", () => {
    expect(confirmedOnText("2026-10-23T10:00:00+00:00")).toBe("Confermati il 23/10/2026");
    expect(confirmedOnText("2026-10-23T23:30:00+00:00")).toBe("Confermati il 24/10/2026");
  });
});

describe("canConfirmAllergens (Q6 = owner only)", () => {
  it("is true for the owner only", () => {
    expect(canConfirmAllergens("owner")).toBe(true);
    for (const role of ["admin", "chef", "waiter", "", null]) {
      expect(canConfirmAllergens(role)).toBe(false);
    }
  });
});
