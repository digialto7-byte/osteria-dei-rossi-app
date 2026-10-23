import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { RECIPE_LIST_LIMIT } from "@/server/recipes/constants";
import { listRecipes } from "@/server/recipes/list";

interface Row {
  recipe_key: string;
  name: string;
  type: "sub";
  is_active: boolean;
  version: number;
  valid_from: string;
}

/**
 * A stand-in for the PostgREST builder: whatever order the calls come in, the rows are sorted by
 * the requested `order` columns and only then cut to `limit`, as the server does.
 */
function fakeClient(table: Row[]) {
  const seen = { orders: [] as string[], limit: null as number | null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    order(column: string) {
      seen.orders.push(column);
      return builder;
    },
    limit(n: number) {
      seen.limit = n;
      return builder;
    },
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      const sorted = [...table].sort((a, b) => {
        for (const column of seen.orders) {
          const x = String(a[column as keyof Row]);
          const y = String(b[column as keyof Row]);
          if (x !== y) return x < y ? -1 : 1;
        }
        return 0;
      });
      return resolve({ data: sorted.slice(0, seen.limit ?? sorted.length), error: null });
    },
  };
  const client = {
    from: () => builder,
    rpc: async () => ({ data: [], error: null }),
  } as unknown as SupabaseClient;
  return { client, seen };
}

const row = (n: number): Row => ({
  recipe_key: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `Ricetta ${String(n).padStart(4, "0")} (demo)`,
  type: "sub",
  is_active: true,
  version: 1,
  valid_from: "2026-10-23T10:00:00Z",
});

describe("listRecipes", () => {
  it("orders by name, then key, in the query, before the limit", async () => {
    const { client, seen } = fakeClient([row(2), row(1)]);
    await listRecipes(client, { type: null, active: true });
    expect(seen.orders).toEqual(["name", "recipe_key"]);
    expect(seen.limit).toBe(RECIPE_LIST_LIMIT);
  });

  it("returns the first 500 by name when there are more, not an arbitrary 500", async () => {
    const all = Array.from({ length: RECIPE_LIST_LIMIT + 25 }, (_, i) => row(i + 1));
    const shuffled = [...all].reverse();
    const { client } = fakeClient(shuffled);
    const { recipes } = await listRecipes(client, { type: null, active: true });
    expect(recipes).toHaveLength(RECIPE_LIST_LIMIT);
    expect(recipes[0]?.name).toBe("Ricetta 0001 (demo)");
    expect(recipes.at(-1)?.name).toBe("Ricetta 0500 (demo)");
    expect(new Set(recipes.map((r) => r.name))).toEqual(
      new Set(all.slice(0, RECIPE_LIST_LIMIT).map((r) => r.name)),
    );
  });

  it("an empty tenant gets an empty list and no summary call", async () => {
    const { client } = fakeClient([]);
    expect(await listRecipes(client, { type: null, active: "all" })).toEqual({ recipes: [] });
  });
});
