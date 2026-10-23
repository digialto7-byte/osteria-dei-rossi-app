import { describe, expect, it } from "vitest";
import {
  buildAllergenSummary,
  buildRecipeDetail,
  type AllergenRow,
  type DetailRows,
} from "@/server/recipes/detail";

const KEY = "aa000000-0000-4000-8000-0000000000aa";
const SUB = "bb000000-0000-4000-8000-0000000000bb";
const BATCH = "cc000000-0000-4000-8000-0000000000cc";
const BEEF = "1a000000-0000-4000-8000-00000000001a";
const FLOUR = "2b000000-0000-4000-8000-00000000002b";
const BREAD = "3c000000-0000-4000-8000-00000000003c";

const batchRows = (): DetailRows => ({
  key: { id: BATCH, type: "batch", is_active: true, current_version: 2 },
  version: {
    id: "v2",
    version: 2,
    valid_from: "2026-10-23T10:00:00+00:00",
    name: "Spezzatino (demo)",
    output_qty: 6,
    output_unit: "kg",
    portions_per_batch: 30,
    shelf_life_hours: 48,
    prep_time_min: 180,
    min_portions: 5,
    target_portions: 30,
  },
  versions: [
    { version: 2, valid_from: "2026-10-23T10:00:00+00:00" },
    { version: 1, valid_from: "2026-10-22T10:00:00+00:00" },
  ],
  lines: [
    { position: 1, ingredient_id: BEEF, sub_recipe_key: null, qty: 5, unit: "kg", yield_factor: 1 },
  ],
  ingredients: { [BEEF]: "Manzo muscolo (demo)" },
  subRecipes: {},
  price: null,
  allergens: { recipe_key: BATCH, allergens: [], confirmed: true, unconfirmed_ingredient_ids: [] },
});

const plateRows = (): DetailRows => ({
  key: { id: KEY, type: "plate", is_active: true, current_version: 1 },
  version: {
    id: "p1",
    version: 1,
    valid_from: "2026-10-23T10:00:00+00:00",
    name: "Spezzatino con polenta (demo)",
    output_qty: null,
    output_unit: null,
    portions_per_batch: null,
    shelf_life_hours: null,
    prep_time_min: null,
    min_portions: null,
    target_portions: null,
  },
  versions: [{ version: 1, valid_from: "2026-10-23T10:00:00+00:00" }],
  lines: [
    {
      position: 1,
      ingredient_id: null,
      sub_recipe_key: BATCH,
      qty: 1,
      unit: "porz",
      yield_factor: 1,
    },
    {
      position: 2,
      ingredient_id: null,
      sub_recipe_key: SUB,
      qty: 0.2,
      unit: "kg",
      yield_factor: 1.5,
    },
    {
      position: 3,
      ingredient_id: BREAD,
      sub_recipe_key: null,
      qty: 1,
      unit: "pz",
      yield_factor: 1,
    },
  ],
  ingredients: { [BREAD]: "Pane (demo)", [FLOUR]: "Farina di mais (demo)" },
  subRecipes: {
    [BATCH]: { name: "Spezzatino (demo)", type: "batch" },
    [SUB]: { name: "Polenta (demo)", type: "sub" },
  },
  price: { sale_price: 12, target_gp_pct: 70 },
  allergens: {
    recipe_key: KEY,
    allergens: ["glutine"],
    confirmed: false,
    unconfirmed_ingredient_ids: [FLOUR],
  },
});

describe("buildRecipeDetail", () => {
  it("derives the portion size on the server: 6 kg over 30 portions is 0.2 kg", () => {
    const detail = buildRecipeDetail(batchRows(), "owner");
    expect(detail.portionSize).toBe(0.2);
    expect(detail.outputQty).toBe(6);
    expect(detail.outputUnit).toBe("kg");
    expect(detail.portionsPerBatch).toBe(30);
  });

  it("has no portion size when the recipe has no portions", () => {
    expect(buildRecipeDetail(plateRows(), "owner").portionSize).toBeNull();
  });

  it("names the targets and marks the current version", () => {
    const detail = buildRecipeDetail(batchRows(), "chef");
    expect(detail).toMatchObject({
      key: BATCH,
      name: "Spezzatino (demo)",
      type: "batch",
      version: 2,
      isCurrent: true,
      isActive: true,
      validFrom: "2026-10-23T10:00:00+00:00",
      versions: [
        { version: 2, validFrom: "2026-10-23T10:00:00+00:00" },
        { version: 1, validFrom: "2026-10-22T10:00:00+00:00" },
      ],
    });
    expect(detail.lines[0]).toEqual({
      position: 1,
      target: { kind: "ingredient", id: BEEF, name: "Manzo muscolo (demo)" },
      qty: 5,
      unit: "kg",
      yieldFactor: 1,
      warnings: [],
    });
  });

  it("a past version is not current", () => {
    const rows = batchRows();
    rows.version = { ...rows.version, version: 1 };
    expect(buildRecipeDetail(rows, "owner")).toMatchObject({ version: 1, isCurrent: false });
  });

  it("a line with a yield above 1 carries the yield_above_one warning", () => {
    const detail = buildRecipeDetail(plateRows(), "owner");
    expect(detail.lines.map((l) => l.warnings)).toEqual([[], ["yield_above_one"], []]);
    expect(detail.lines[1]!.target).toEqual({
      kind: "recipe",
      id: SUB,
      name: "Polenta (demo)",
      type: "sub",
    });
  });

  it("reports allergens as da_confermare with the unconfirmed names, never as none", () => {
    const detail = buildRecipeDetail(plateRows(), "owner");
    expect(detail.allergens).toEqual({
      list: ["glutine"],
      status: "da_confermare",
      unconfirmedIngredients: [{ id: FLOUR, name: "Farina di mais (demo)" }],
    });
  });

  it("a confirmed recipe with no allergens is confirmed with an empty list", () => {
    expect(buildRecipeDetail(batchRows(), "owner").allergens).toEqual({
      list: [],
      status: "confirmed",
      unconfirmedIngredients: [],
    });
  });

  it("a recipe the summary did not answer for is da_confermare, not allergen-free", () => {
    const rows = batchRows();
    rows.allergens = undefined;
    expect(buildRecipeDetail(rows, "owner").allergens.status).toBe("da_confermare");
  });

  describe("prices (Q16 = V6)", () => {
    it("owner and admin get the price and may edit it on the current version", () => {
      for (const role of ["owner", "admin"] as const) {
        const detail = buildRecipeDetail(plateRows(), role);
        expect(detail.pricing).toEqual({ salePrice: 12, targetGpPct: 70 });
        expect(detail.canEditPrice).toBe(true);
        expect(detail.canDeactivate).toBe(true);
      }
    });

    it("the chef reads the menu price and the target GP%, and cannot edit or deactivate", () => {
      const detail = buildRecipeDetail(plateRows(), "chef");
      expect(detail.pricing).toEqual({ salePrice: 12, targetGpPct: 70 });
      expect(detail.canEditPrice).toBe(false);
      expect(detail.canDeactivate).toBe(false);
    });

    it("never exposes a euro cost or margin to any role", () => {
      for (const role of ["owner", "admin", "chef"] as const) {
        for (const rows of [plateRows(), batchRows()]) {
          const json = JSON.stringify(buildRecipeDetail(rows, role));
          expect(json).not.toMatch(/cost|margin|costo|margine/i);
        }
      }
    });

    it("only a plate has pricing; a plate without a price row has null values", () => {
      expect(buildRecipeDetail(batchRows(), "owner")).not.toHaveProperty("pricing");
      const rows = plateRows();
      rows.price = null;
      expect(buildRecipeDetail(rows, "chef").pricing).toEqual({
        salePrice: null,
        targetGpPct: null,
      });
    });

    it("a past version cannot be edited", () => {
      const rows = plateRows();
      rows.key = { ...rows.key, current_version: 3 };
      expect(buildRecipeDetail(rows, "owner").canEditPrice).toBe(false);
    });
  });

  it("returns no staff names or ids of people", () => {
    const json = JSON.stringify(buildRecipeDetail(plateRows(), "owner"));
    expect(json).not.toMatch(/created_?by|display_?name/i);
  });
});

describe("buildAllergenSummary", () => {
  const names = { [FLOUR]: "Farina di mais (demo)", [BEEF]: "Manzo muscolo (demo)" };
  const row = (over: Partial<AllergenRow>): AllergenRow => ({
    recipe_key: KEY,
    allergens: [],
    confirmed: true,
    unconfirmed_ingredient_ids: [],
    ...over,
  });

  it("sorts the unconfirmed ingredients by name and falls back to the id for an unreadable one", () => {
    const summary = buildAllergenSummary(
      row({ confirmed: false, unconfirmed_ingredient_ids: [FLOUR, BEEF, BREAD] }),
      names,
    );
    expect(summary.unconfirmedIngredients.map((i) => i.name)).toEqual(
      [BREAD, "Farina di mais (demo)", "Manzo muscolo (demo)"].sort((a, b) =>
        a.localeCompare(b, "it"),
      ),
    );
  });

  it("a recipe flagged unconfirmed with no ingredient listed is still da_confermare", () => {
    expect(buildAllergenSummary(row({ confirmed: false }), names).status).toBe("da_confermare");
  });
});
