import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../../helpers/fake-supabase";
import { dbError, ok } from "../../helpers/review-data";
import { collectNameRefs, loadNames } from "@/server/alerts/names";
import { reportError } from "@/lib/observability/report";

vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const ING = "1a000000-0000-4000-8000-00000000001a";
const ING2 = "1b000000-0000-4000-8000-00000000001b";
const LOC = "10000000-0000-4000-8000-0000000000a1";
const RECIPE = "b2000000-0000-4000-8000-000000000001";
const SUPPLIER = "5a000000-0000-4000-8000-00000000005a";
const LOT = "10700000-0000-4000-8000-0000000000a1";
const BATCH = "ba000000-0000-4000-8000-0000000000a1";
const none = { ingredient: [], location: [], recipe: [], supplier: [], raw_lot: [], batch: [] };
const negative = (ingredient = ING, location = LOC) => ({
  kind: "negative_stock",
  payload: { ingredient_id: ingredient, location_id: location, on_hand_qty: -1, unit: "kg" },
});

describe("collectNameRefs", () => {
  it("takes ids only from kinds whose template declares nameRefs, de-duplicated", () => {
    const refs = collectNameRefs([
      negative(),
      negative(),
      negative(ING2, LOC),
      {
        kind: "price_variance",
        payload: { ingredient_id: "1c000000-0000-4000-8000-00000000001c" },
      },
      { kind: "test_alert", payload: {} },
    ]);
    expect(refs).toEqual({
      ingredient: [ING, ING2],
      location: [LOC],
      recipe: [],
      supplier: [],
      raw_lot: [],
      batch: [],
    });
  });

  it("keeps valid uuids only and ignores non-object payloads and unknown kinds", () => {
    const refs = collectNameRefs([
      negative("not-a-uuid", 'x" or id.neq.0'),
      { kind: "negative_stock", payload: null },
      { kind: "negative_stock", payload: [] },
      { kind: "negative_stock", payload: { ingredient_id: 5, location_id: null } },
      { kind: "no_such_kind", payload: { ingredient_id: ING } },
    ]);
    expect(refs).toEqual({
      ingredient: [],
      location: [],
      recipe: [],
      supplier: [],
      raw_lot: [],
      batch: [],
    });
  });

  it("collects the M16 refs: recipe_key, supplier_id, raw_lot_id and batch_id, valid uuids only", () => {
    const refs = collectNameRefs([
      {
        kind: "prep_raw_short",
        payload: { recipe_key: RECIPE, ingredient_id: ING, supplier_id: SUPPLIER },
      },
      { kind: "prep_due", payload: { recipe_key: RECIPE, ingredient_id: null } },
      { kind: "raw_lot_expiring", payload: { raw_lot_id: LOT, ingredient_id: ING2 } },
      { kind: "batch_expiring", payload: { batch_id: BATCH, recipe_key: "not-a-uuid" } },
      { kind: "purchase_due", payload: { ingredient_id: ING, supplier_id: SUPPLIER } },
    ]);
    expect(refs).toEqual({
      ingredient: [ING, ING2],
      location: [],
      recipe: [RECIPE],
      supplier: [SUPPLIER],
      raw_lot: [LOT],
      batch: [BATCH],
    });
  });
});

describe("loadNames", () => {
  it("issues one in-query per table, on the given (reader) client", async () => {
    const client = fakeSupabase({
      results: {
        ingredient: [ok([{ id: ING, name: "Manzo muscolo (demo)" }])],
        location: [ok([{ id: LOC, name: "Cella (demo)" }])],
      },
    });
    const names = await loadNames(client as never, { ...none, ingredient: [ING], location: [LOC] });
    expect(client.from).toHaveBeenCalledTimes(2);
    expect(client.from).toHaveBeenCalledWith("ingredient");
    expect(client.from).toHaveBeenCalledWith("location");
    expect(client.query.select).toHaveBeenCalledWith("id, name");
    expect(client.query.in).toHaveBeenCalledWith("id", [ING]);
    expect(client.query.in).toHaveBeenCalledWith("id", [LOC]);
    expect(names.ingredient.get(ING)).toBe("Manzo muscolo (demo)");
    expect(names.location.get(LOC)).toBe("Cella (demo)");
  });

  it("makes no query for an empty table", async () => {
    const client = fakeSupabase();
    const names = await loadNames(client as never, none);
    expect(client.from).not.toHaveBeenCalled();
    expect(names.ingredient.size + names.location.size).toBe(0);
  });

  it("a failed read leaves the names out and reports the SQLSTATE only", async () => {
    const client = fakeSupabase({
      results: { ingredient: [dbError("57014", "boom SEGRETO")], location: [ok([])] },
    });
    const names = await loadNames(client as never, { ...none, ingredient: [ING], location: [LOC] });
    expect(names.ingredient.size).toBe(0);
    const reported = vi.mocked(reportError).mock.calls.map(([e]) => String(e));
    expect(reported.join(" ")).toContain("57014");
    expect(reported.join(" ")).not.toContain("SEGRETO");
  });

  it("reads the M16 tables with the right columns, on the reader's client", async () => {
    const client = fakeSupabase({
      results: {
        v_recipe_current: [ok([{ recipe_key: RECIPE, name: "Spezzatino (demo)" }])],
        supplier: [ok([{ id: SUPPLIER, name: "Macelleria X (demo)" }])],
        raw_lot: [ok([{ id: LOT, lot_code: "L-EXP" }])],
        batch: [ok([{ id: BATCH, lot_code: "261102-SPEZZA-1" }])],
      },
    });
    const names = await loadNames(client as never, {
      ...none,
      recipe: [RECIPE],
      supplier: [SUPPLIER],
      raw_lot: [LOT],
      batch: [BATCH],
    });
    expect(client.from).toHaveBeenCalledWith("v_recipe_current");
    expect(client.from).toHaveBeenCalledWith("supplier");
    expect(client.from).toHaveBeenCalledWith("raw_lot");
    expect(client.from).toHaveBeenCalledWith("batch");
    expect(client.query.select).toHaveBeenCalledWith("recipe_key, name");
    expect(client.query.select).toHaveBeenCalledWith("id, lot_code");
    expect(client.query.in).toHaveBeenCalledWith("recipe_key", [RECIPE]);
    expect(client.query.in).toHaveBeenCalledWith("id", [LOT]);
    expect(names.recipe.get(RECIPE)).toBe("Spezzatino (demo)");
    expect(names.supplier.get(SUPPLIER)).toBe("Macelleria X (demo)");
    expect(names.raw_lot.get(LOT)).toBe("L-EXP");
    expect(names.batch.get(BATCH)).toBe("261102-SPEZZA-1");
  });

  it("a failed read of a M16 table leaves the neutral word", async () => {
    const client = fakeSupabase({ results: { supplier: [dbError("42501", "denied SEGRETO")] } });
    const names = await loadNames(client as never, { ...none, supplier: [SUPPLIER] });
    expect(names.supplier.size).toBe(0);
  });
});
