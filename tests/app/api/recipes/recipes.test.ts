import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const listRoute = await import("@/app/api/recipes/route");
const keyRoute = await import("@/app/api/recipes/[key]/route");
const versionsRoute = await import("@/app/api/recipes/[key]/versions/route");
const versionRoute = await import("@/app/api/recipes/[key]/versions/[version]/route");

const KEY = "cc000000-0000-4000-8000-0000000000cc";
const ING = "1a000000-0000-4000-8000-00000000001a";
const BASE = "http://localhost:3000/api/recipes";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const KEY_ROW = { id: KEY, type: "batch", is_active: true, current_version: 2 };
const VERSION_ROW = (version: number) => ({
  id: `v${version}`,
  version,
  valid_from: "2026-10-23T10:00:00+00:00",
  name: "Spezzatino (demo)",
  output_qty: 6,
  output_unit: "kg",
  portions_per_batch: 30,
  shelf_life_hours: 48,
  prep_time_min: 180,
  min_portions: 5,
  target_portions: 30,
});
const LINES = [
  { position: 1, ingredient_id: ING, sub_recipe_key: null, qty: 5, unit: "kg", yield_factor: 1 },
];
const SUMMARY = [
  { recipe_key: KEY, allergens: [], confirmed: true, unconfirmed_ingredient_ids: [] },
];

const content = {
  name: "Spezzatino (demo)",
  outputQty: 6,
  outputUnit: "kg",
  portionsPerBatch: 30,
  shelfLifeHours: 48,
  lines: [{ ingredientId: ING, qty: 5, unit: "kg" }],
};

/** Scripts what the detail loader reads after a write or for a GET, in its call order. */
function detailResults(version = 2) {
  return {
    recipe_key: [ok(KEY_ROW)],
    recipe: [
      ok(VERSION_ROW(version)),
      ok([
        { version: 2, valid_from: "2026-10-23T10:00:00+00:00" },
        { version: 1, valid_from: "2026-10-22T10:00:00+00:00" },
      ]),
    ],
    recipe_line: [ok(LINES)],
    v_recipe_current: [ok([])],
    recipe_price: [ok(null)],
    ingredient: [ok([{ id: ING, name: "Manzo muscolo (demo)" }])],
  };
}

function as(
  role: string,
  rpc: Record<string, FakeResult[]> = {},
  results: Record<string, FakeResult[]> = detailResults(),
) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { recipe_allergen_summary: [ok(SUMMARY)], ...rpc },
    results,
  });
}
beforeEach(() => as("owner"));

const post = (
  route: typeof listRoute.POST,
  url: string,
  body: unknown,
  params = {},
  init?: RequestInit,
) => route(jsonRequest(url, body, init), routeContext(params));

describe("role table: waiters and anonymous callers", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET /api/recipes", () => listRoute.GET(new Request(BASE))],
    ["POST /api/recipes", () => post(listRoute.POST, BASE, { type: "batch", ...content })],
    [
      "GET /api/recipes/:key",
      () => keyRoute.GET(new Request(`${BASE}/${KEY}`), routeContext({ key: KEY })),
    ],
    [
      "PATCH /api/recipes/:key",
      () =>
        keyRoute.PATCH(
          jsonRequest(`${BASE}/${KEY}`, { isActive: false }, { method: "PATCH" }),
          routeContext({ key: KEY }),
        ),
    ],
    [
      "POST /api/recipes/:key/versions",
      () =>
        post(
          versionsRoute.POST,
          `${BASE}/${KEY}/versions`,
          { baseVersion: 2, ...content },
          { key: KEY },
        ),
    ],
    [
      "GET /api/recipes/:key/versions/:version",
      () =>
        versionRoute.GET(
          new Request(`${BASE}/${KEY}/versions/1`),
          routeContext({ key: KEY, version: "1" }),
        ),
    ],
  ];

  it.each(calls)("%s: a waiter gets 403 before any query", async (_name, call) => {
    as("waiter");
    expect((await call()).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: no session gets 401", async (_name, call) => {
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("GET /api/recipes", () => {
  const rows = [
    {
      recipe_key: "k2",
      name: "Polenta (demo)",
      type: "sub",
      is_active: true,
      version: 1,
      valid_from: "2026-10-23T09:00:00+00:00",
    },
    {
      recipe_key: KEY,
      name: "Spezzatino (demo)",
      type: "batch",
      is_active: true,
      version: 2,
      valid_from: "2026-10-23T10:00:00+00:00",
    },
  ];

  it.each(["owner", "admin", "chef"])(
    "%s lists the current versions with the allergen state",
    async (role) => {
      as(
        role,
        {
          recipe_allergen_summary: [
            ok([
              { recipe_key: KEY, allergens: [], confirmed: true, unconfirmed_ingredient_ids: [] },
              {
                recipe_key: "k2",
                allergens: [],
                confirmed: false,
                unconfirmed_ingredient_ids: [ING],
              },
            ]),
          ],
        },
        {
          v_recipe_current: [ok(rows)],
          ingredient: [ok([{ id: ING, name: "Farina di mais (demo)" }])],
        },
      );
      const response = await listRoute.GET(new Request(BASE));
      expect(response.status).toBe(200);
      const { recipes } = await response.json();
      expect(recipes.map((r: { name: string }) => r.name)).toEqual([
        "Polenta (demo)",
        "Spezzatino (demo)",
      ]);
      expect(recipes[0]).toEqual({
        key: "k2",
        name: "Polenta (demo)",
        type: "sub",
        version: 1,
        validFrom: "2026-10-23T09:00:00+00:00",
        isActive: true,
        allergens: {
          list: [],
          status: "da_confermare",
          unconfirmedIngredients: [{ id: ING, name: "Farina di mais (demo)" }],
        },
      });
      expect(recipes[1].allergens.status).toBe("confirmed");
      expect(client.rpc).toHaveBeenCalledWith("recipe_allergen_summary", { p_keys: ["k2", KEY] });
    },
  );

  it("filters by type and active state in the query", async () => {
    as("owner", {}, { v_recipe_current: [ok([])] });
    const response = await listRoute.GET(new Request(`${BASE}?type=plate&active=all`));
    expect(response.status).toBe(200);
    expect(client.query.eq).toHaveBeenCalledWith("type", "plate");
    expect(client.query.eq).not.toHaveBeenCalledWith("is_active", expect.anything());
  });

  it("shows only active recipes by default", async () => {
    as("owner", {}, { v_recipe_current: [ok([])] });
    await listRoute.GET(new Request(BASE));
    expect(client.query.eq).toHaveBeenCalledWith("is_active", true);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["?type=x", "?active=maybe", "?foo=1"])("refuses %s with 400", async (query) => {
    expect((await listRoute.GET(new Request(`${BASE}${query}`))).status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers the order the screen shows even if the database sorted differently", async () => {
    as("owner", {}, { v_recipe_current: [ok([...rows].reverse())], ingredient: [ok([])] });
    const { recipes } = await (await listRoute.GET(new Request(BASE))).json();
    expect(recipes.map((r: { name: string }) => r.name)).toEqual([
      "Polenta (demo)",
      "Spezzatino (demo)",
    ]);
  });
});

describe("GET /api/recipes/:key and a past version", () => {
  it("returns the current version as a detail", async () => {
    const response = await keyRoute.GET(new Request(`${BASE}/${KEY}`), routeContext({ key: KEY }));
    expect(response.status).toBe(200);
    const { recipe } = await response.json();
    expect(recipe).toMatchObject({ key: KEY, version: 2, isCurrent: true, portionSize: 0.2 });
    expect(recipe.lines[0].target.name).toBe("Manzo muscolo (demo)");
  });

  it("returns a past version, not current", async () => {
    as("chef", {}, detailResults(1));
    const response = await versionRoute.GET(
      new Request(`${BASE}/${KEY}/versions/1`),
      routeContext({ key: KEY, version: "1" }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).recipe).toMatchObject({ version: 1, isCurrent: false });
    expect(client.query.eq).toHaveBeenCalledWith("version", 1);
  });

  it("an unknown key or version is 404", async () => {
    as("owner", {}, { recipe_key: [ok(null)] });
    expect(
      (await keyRoute.GET(new Request(`${BASE}/${KEY}`), routeContext({ key: KEY }))).status,
    ).toBe(404);
    as("owner", {}, { ...detailResults(), recipe: [ok(null)] });
    expect(
      (
        await versionRoute.GET(
          new Request(`${BASE}/${KEY}/versions/9`),
          routeContext({ key: KEY, version: "9" }),
        )
      ).status,
    ).toBe(404);
  });

  it.each([
    ["not-a-uuid", "1"],
    [KEY, "0"],
    [KEY, "x"],
    [KEY, "1.5"],
  ])("a malformed key or version (%s, %s) is 404 without a query", async (key, version) => {
    expect((await versionRoute.GET(new Request(BASE), routeContext({ key, version }))).status).toBe(
      404,
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("the chef reads the price fields but nothing in euros of cost", async () => {
    const plateKey = { id: KEY, type: "plate", is_active: true, current_version: 1 };
    as(
      "chef",
      { recipe_allergen_summary: [ok(SUMMARY)] },
      {
        ...detailResults(1),
        recipe_key: [ok(plateKey)],
        recipe_price: [ok({ sale_price: 12, target_gp_pct: 70 })],
      },
    );
    const json = await (
      await keyRoute.GET(new Request(`${BASE}/${KEY}`), routeContext({ key: KEY }))
    ).json();
    expect(json.recipe.pricing).toEqual({ salePrice: 12, targetGpPct: 70 });
    expect(json.recipe.canEditPrice).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/cost|margin/i);
  });
});

describe("POST /api/recipes", () => {
  it("creates through the procedure and answers 201 with the detail and the warnings", async () => {
    as(
      "owner",
      {
        create_recipe: [
          ok({
            key: KEY,
            version: 1,
            recipeId: "v1",
            warnings: [{ line: 1, code: "yield_above_one" }],
          }),
        ],
      },
      detailResults(1),
    );
    const response = await post(listRoute.POST, BASE, { type: "batch", ...content });
    expect(response.status).toBe(201);
    expect(client.rpc).toHaveBeenCalledWith("create_recipe", {
      p_type: "batch",
      p_content: content,
    });
    const json = await response.json();
    expect(json.recipe.key).toBe(KEY);
    expect(json.warnings).toEqual([{ line: 1, code: "yield_above_one" }]);
  });

  it("AT3: a yield of 0 is 422 recipe_invalid with the field, before any procedure call", async () => {
    const body = {
      type: "batch",
      ...content,
      lines: [{ ingredientId: ING, qty: 5, unit: "kg", yieldFactor: 0 }],
    };
    const response = await post(listRoute.POST, BASE, body);
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("recipe_invalid");
    expect(error.details).toEqual([
      { field: "lines.0.yieldFactor", code: "yield_factor_not_positive" },
    ]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("AT5: a chef body naming salePrice or targetGpPct is 403 recipe_price_forbidden before the procedure, even unchanged or null", async () => {
    for (const price of [{ salePrice: 12 }, { targetGpPct: 70 }, { salePrice: null }]) {
      as("chef");
      const response = await post(listRoute.POST, BASE, {
        type: "plate",
        name: "P",
        ...price,
        lines: [{ ingredientId: ING, qty: 1, unit: "kg" }],
      });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("recipe_price_forbidden");
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("a chef may create a plate without a price", async () => {
    as(
      "chef",
      { create_recipe: [ok({ key: KEY, version: 1, recipeId: "v1", warnings: [] })] },
      detailResults(1),
    );
    const response = await post(listRoute.POST, BASE, {
      type: "plate",
      name: "P",
      lines: [{ ingredientId: ING, qty: 1, unit: "kg" }],
    });
    expect(response.status).toBe(201);
  });

  it("an admin and an owner may send a price", async () => {
    for (const role of ["owner", "admin"]) {
      as(
        role,
        { create_recipe: [ok({ key: KEY, version: 1, recipeId: "v1", warnings: [] })] },
        detailResults(1),
      );
      const response = await post(listRoute.POST, BASE, {
        type: "plate",
        name: "P",
        salePrice: 12,
        targetGpPct: 70,
        lines: [{ ingredientId: ING, qty: 1, unit: "kg" }],
      });
      expect(response.status).toBe(201);
    }
  });

  it("maps procedure errors: name taken 409, cycle 422 in Italian, invalid reference 422 with rows", async () => {
    as("owner", { create_recipe: [failure("P0001", "recipe_name_taken")] });
    expect((await post(listRoute.POST, BASE, { type: "batch", ...content })).status).toBe(409);
    as("owner", { create_recipe: [failure("P0001", "recipe_cycle", "a,b,a")] });
    const cycle = await post(listRoute.POST, BASE, { type: "batch", ...content });
    expect(cycle.status).toBe(422);
    const { error } = await cycle.json();
    expect(error.code).toBe("recipe_cycle");
    expect(error.message).toBe(
      "Questa sottoricetta usa già, direttamente o indirettamente, la ricetta che stai modificando.",
    );
    as("owner", {
      create_recipe: [
        failure(
          "P0001",
          "recipe_invalid",
          '[{"field":"lines.0.ingredientId","code":"unknown_ingredient"}]',
        ),
      ],
    });
    const invalid = await post(listRoute.POST, BASE, { type: "batch", ...content });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.details).toEqual([
      { field: "lines.0.ingredientId", code: "unknown_ingredient" },
    ]);
  });

  it("an unknown database error is 500 and never echoes the message", async () => {
    as("owner", { create_recipe: [failure("XX000", "secret internal detail")] });
    const response = await post(listRoute.POST, BASE, { type: "batch", ...content });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret internal detail");
  });

  it("refuses an unknown key (400) and a non-JSON body (415)", async () => {
    expect((await post(listRoute.POST, BASE, { type: "batch", ...content, extra: 1 })).status).toBe(
      400,
    );
    const text = new Request(BASE, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect((await listRoute.POST(text)).status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/recipes/:key/versions", () => {
  const url = `${BASE}/${KEY}/versions`;
  const body = { baseVersion: 1, ...content };

  it("AT1: calls create_recipe_version with the key, the base version and the content, and answers 201 with version 2", async () => {
    as("chef", {
      create_recipe_version: [ok({ key: KEY, version: 2, recipeId: "v2", warnings: [] })],
    });
    const response = await post(versionsRoute.POST, url, body, { key: KEY });
    expect(response.status).toBe(201);
    expect(client.rpc).toHaveBeenCalledWith("create_recipe_version", {
      p_key: KEY,
      p_base_version: 1,
      p_content: content,
    });
    expect((await response.json()).recipe.version).toBe(2);
  });

  it("AT5: a chef version with a new shelf life is 201", async () => {
    as("chef", {
      create_recipe_version: [ok({ key: KEY, version: 2, recipeId: "v2", warnings: [] })],
    });
    const response = await post(
      versionsRoute.POST,
      url,
      { ...body, shelfLifeHours: 96 },
      { key: KEY },
    );
    expect(response.status).toBe(201);
  });

  it("AT5: a chef version naming salePrice is 403 before the procedure", async () => {
    as("chef");
    const response = await post(versionsRoute.POST, url, { ...body, salePrice: 12 }, { key: KEY });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("recipe_price_forbidden");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("AT1: a stale base version is 409 version_conflict with the current version in details", async () => {
    as("owner", {
      create_recipe_version: [failure("P0001", "version_conflict", '{"currentVersion":2}')],
    });
    const response = await post(versionsRoute.POST, url, body, { key: KEY });
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error.code).toBe("version_conflict");
    expect(error.details).toEqual([{ currentVersion: 2 }]);
    expect(error.message).toContain("2");
  });

  it("AT2: a cycle is 422 recipe_cycle", async () => {
    as("owner", { create_recipe_version: [failure("P0001", "recipe_cycle", "a,b,a")] });
    const response = await post(versionsRoute.POST, url, body, { key: KEY });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("recipe_cycle");
  });

  it("AT3: a negative yield is 422 before the procedure", async () => {
    const bad = { ...body, lines: [{ ingredientId: ING, qty: 5, unit: "kg", yieldFactor: -1 }] };
    const response = await post(versionsRoute.POST, url, bad, { key: KEY });
    expect(response.status).toBe(422);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an unchanged body is 422 recipe_unchanged, an inactive recipe 409", async () => {
    as("owner", { create_recipe_version: [failure("P0001", "recipe_unchanged")] });
    expect((await post(versionsRoute.POST, url, body, { key: KEY })).status).toBe(422);
    as("owner", { create_recipe_version: [failure("P0001", "recipe_inactive")] });
    expect((await post(versionsRoute.POST, url, body, { key: KEY })).status).toBe(409);
  });

  it("an unknown key is 404 before the procedure; a malformed key is 404", async () => {
    as("owner", {}, { recipe_key: [ok(null)] });
    expect((await post(versionsRoute.POST, url, body, { key: KEY })).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
    expect((await post(versionsRoute.POST, url, body, { key: "nope" })).status).toBe(404);
  });

  it("needs a base version", async () => {
    expect((await post(versionsRoute.POST, url, content, { key: KEY })).status).toBe(400);
  });
});

describe("PATCH /api/recipes/:key", () => {
  const patch = (body: unknown) =>
    keyRoute.PATCH(
      jsonRequest(`${BASE}/${KEY}`, body, { method: "PATCH" }),
      routeContext({ key: KEY }),
    );

  it.each(["owner", "admin"])("%s toggles the active state through the procedure", async (role) => {
    as(
      role,
      { set_recipe_active: [ok({ key: KEY, isActive: false, version: 2 })] },
      {
        ...detailResults(),
        recipe_key: [ok({ ...KEY_ROW, is_active: false })],
      },
    );
    const response = await patch({ isActive: false });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("set_recipe_active", { p_key: KEY, p_active: false });
    expect((await response.json()).recipe).toMatchObject({ key: KEY, isActive: false });
  });

  it("a chef gets 403 before the procedure", async () => {
    as("chef");
    expect((await patch({ isActive: false })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("is strict and maps not found", async () => {
    expect((await patch({ isActive: false, name: "x" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    as("owner", { set_recipe_active: [failure("P0002", "not_found")] });
    expect((await patch({ isActive: true })).status).toBe(404);
  });
});
