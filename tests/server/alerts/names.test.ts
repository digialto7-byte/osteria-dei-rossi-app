import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../../helpers/fake-supabase";
import { dbError, ok } from "../../helpers/review-data";
import { collectNameRefs, loadNames } from "@/server/alerts/names";
import { reportError } from "@/lib/observability/report";

vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const ING = "1a000000-0000-4000-8000-00000000001a";
const ING2 = "1b000000-0000-4000-8000-00000000001b";
const LOC = "10000000-0000-4000-8000-0000000000a1";
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
    expect(refs).toEqual({ ingredient: [ING, ING2], location: [LOC] });
  });

  it("keeps valid uuids only and ignores non-object payloads and unknown kinds", () => {
    const refs = collectNameRefs([
      negative("not-a-uuid", 'x" or id.neq.0'),
      { kind: "negative_stock", payload: null },
      { kind: "negative_stock", payload: [] },
      { kind: "negative_stock", payload: { ingredient_id: 5, location_id: null } },
      { kind: "no_such_kind", payload: { ingredient_id: ING } },
    ]);
    expect(refs).toEqual({ ingredient: [], location: [] });
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
    const names = await loadNames(client as never, { ingredient: [ING], location: [LOC] });
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
    const names = await loadNames(client as never, { ingredient: [], location: [] });
    expect(client.from).not.toHaveBeenCalled();
    expect(names.ingredient.size + names.location.size).toBe(0);
  });

  it("a failed read leaves the names out and reports the SQLSTATE only", async () => {
    const client = fakeSupabase({
      results: { ingredient: [dbError("57014", "boom SEGRETO")], location: [ok([])] },
    });
    const names = await loadNames(client as never, { ingredient: [ING], location: [LOC] });
    expect(names.ingredient.size).toBe(0);
    const reported = vi.mocked(reportError).mock.calls.map(([e]) => String(e));
    expect(reported.join(" ")).toContain("57014");
    expect(reported.join(" ")).not.toContain("SEGRETO");
  });
});
