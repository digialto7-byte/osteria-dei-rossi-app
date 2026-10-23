import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RecipeDetail, RecipeSummary } from "@/server/recipes/detail";
import type { RecipeImportResult } from "@/server/recipes/import";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M7 acceptance tests 1 to 6 against the real local stack: immutable versions, the cycle check, the
// yield rule, the import/export round trip with a rolled-back preview, the chef's rights, and the
// allergen state with the owner's confirmation. The route handlers run for real (schemas, role
// checks, error mapping, the recipe procedures, RLS); only `createSupabaseServerClient` is replaced,
// because it would read cookies from a Next.js request: each call is handed the signed-in test
// user's own client (publishable key + that user's JWT).
//
// Every read and write goes through a user session or the API. recipe_key, recipe, recipe_line and
// recipe_price grant nothing to the secret key, and the secret key never reads an RLS-protected table
// here, so row counts are read through the owner's session. Fixtures are fake ("(demo)" names).
//
// The tests run in order and share state: tenant A holds the recipes, tenant B must see none of them.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const importIngredientsRoute = await import("@/app/api/admin/import/ingredients/route");
const ingredientsRoute = await import("@/app/api/ingredients/route");
const confirmRoute = await import("@/app/api/ingredients/[id]/allergens/confirm/route");
const recipesRoute = await import("@/app/api/recipes/route");
const recipeRoute = await import("@/app/api/recipes/[key]/route");
const versionsRoute = await import("@/app/api/recipes/[key]/versions/route");
const versionRoute = await import("@/app/api/recipes/[key]/versions/[version]/route");
const importRecipesRoute = await import("@/app/api/admin/import/recipes/route");
const exportRecipesRoute = await import("@/app/api/admin/export/recipes/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  error: { code: string; message: string; details?: Record<string, string | number>[] };
}

/** One request to a real route handler, as the given user. */
async function call<T = Record<string, unknown>>(
  user: TestUser,
  handler: Handler,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<Reply<T>> {
  session.client = user.client;
  const method = init.method ?? "GET";
  const response = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { params: Promise.resolve(init.params ?? {}) },
  );
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
    error: (body as { error?: Reply["error"] }).error as Reply["error"],
  };
}

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/import/${name}`, import.meta.url), "utf8");
const demoCsv = fixture("ricette-demo.csv");
const demoJson = JSON.parse(fixture("ricette-demo.json")) as { recipes: object[] };

// Fake ingredients, imported through the M1 route. The blank allergen cell of the flour is the point.
const INGREDIENT_CSV = [
  "nome;unita_base;categoria;a_magazzino;allergeni;giorni_conservazione",
  "Manzo muscolo (demo);kg;Carne;si;nessuno;",
  "Farina di mais (demo);kg;Secco;si;;",
  "Pane (demo);pz;Forno;si;glutine;",
].join("\n");

const importRecipes = (user: TestUser, body: object) =>
  call<RecipeImportResult>(user, importRecipesRoute.POST as Handler, "/api/admin/import/recipes", {
    method: "POST",
    body,
  });
const exportRecipes = (user: TestUser) =>
  call<{ recipes: object[] }>(user, exportRecipesRoute.GET as Handler, "/api/admin/export/recipes");
const listRecipes = (user: TestUser, query = "") =>
  call<{ recipes: RecipeSummary[] }>(user, recipesRoute.GET as Handler, `/api/recipes${query}`);
const createRecipe = (user: TestUser, body: object) =>
  call<{ recipe: RecipeDetail; warnings: { line: number; code: string }[] }>(
    user,
    recipesRoute.POST as Handler,
    "/api/recipes",
    { method: "POST", body },
  );
const getRecipe = (user: TestUser, key: string) =>
  call<{ recipe: RecipeDetail }>(user, recipeRoute.GET as Handler, `/api/recipes/${key}`, {
    params: { key },
  });
const getVersion = (user: TestUser, key: string, version: number) =>
  call<{ recipe: RecipeDetail }>(
    user,
    versionRoute.GET as Handler,
    `/api/recipes/${key}/versions/${version}`,
    { params: { key, version: String(version) } },
  );
const newVersion = (user: TestUser, key: string, body: object) =>
  call<{ recipe: RecipeDetail; warnings: { line: number; code: string }[] }>(
    user,
    versionsRoute.POST as Handler,
    `/api/recipes/${key}/versions`,
    { method: "POST", body, params: { key } },
  );
const confirmAllergens = (user: TestUser, id: string, allergens: string[]) =>
  call(user, confirmRoute.POST as Handler, `/api/ingredients/${id}/allergens/confirm`, {
    method: "POST",
    body: { allergens },
    params: { id },
  });

/** The body of a new version that repeats a version's content (ids from the detail), with changes. */
function contentOf(recipe: RecipeDetail, changes: Record<string, unknown> = {}) {
  return {
    name: recipe.name,
    ...(recipe.outputQty !== null
      ? { outputQty: recipe.outputQty, outputUnit: recipe.outputUnit }
      : {}),
    ...(recipe.portionsPerBatch !== null ? { portionsPerBatch: recipe.portionsPerBatch } : {}),
    ...(recipe.shelfLifeHours !== null ? { shelfLifeHours: recipe.shelfLifeHours } : {}),
    ...(recipe.prepTimeMin !== null ? { prepTimeMin: recipe.prepTimeMin } : {}),
    ...(recipe.minPortions !== null ? { minPortions: recipe.minPortions } : {}),
    ...(recipe.targetPortions !== null ? { targetPortions: recipe.targetPortions } : {}),
    lines: recipe.lines.map((line) => ({
      ...(line.target.kind === "ingredient"
        ? { ingredientId: line.target.id }
        : { recipeKey: line.target.id }),
      qty: line.qty,
      unit: line.unit,
      yieldFactor: line.yieldFactor,
    })),
    ...changes,
  };
}

describe.skipIf(!env)("recipes on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  const ingredientIds = new Map<string, string>();
  const keys = new Map<string, string>();

  /** Row counts of a table as the owner of a tenant reads it (the secret key has no grant). */
  const count = async (tenant: TestTenant, table: string) => {
    const { count: rows, error } = await tenant.owner.client
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(`Fixture read failed: ${error.message}`);
    return rows ?? 0;
  };

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;

    // M1 import by the admin; then the owner confirms the two lists that should not hold the plate back.
    const imported = await call(
      a.admin,
      importIngredientsRoute.POST as Handler,
      "/api/admin/import/ingredients",
      {
        method: "POST",
        body: { format: "csv", csv: INGREDIENT_CSV },
      },
    );
    expect(imported.status).toBe(200);
    const listed = await call<{ ingredients: { id: string; name: string }[] }>(
      a.owner,
      ingredientsRoute.GET as Handler,
      "/api/ingredients",
    );
    for (const ingredient of listed.body.ingredients)
      ingredientIds.set(ingredient.name, ingredient.id);
    expect(
      (await confirmAllergens(a.owner, ingredientIds.get("Manzo muscolo (demo)")!, [])).status,
    ).toBe(200);
    expect(
      (await confirmAllergens(a.owner, ingredientIds.get("Pane (demo)")!, ["glutine"])).status,
    ).toBe(200);
  }, 120_000);

  describe("AT4 the demo fixture round-trips through the API unchanged", () => {
    it("a dry run reports three new recipes and writes nothing", async () => {
      const preview = await importRecipes(a.admin, { format: "csv", csv: demoCsv, dryRun: true });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({
        dryRun: true,
        created: 3,
        newVersions: 0,
        unchanged: 0,
      });
      expect(preview.body.recipes.map((r) => r.action)).toEqual(["create", "create", "create"]);
      for (const table of ["recipe_key", "recipe", "recipe_line", "recipe_price"]) {
        expect(await count(a, table), table).toBe(0);
      }
      expect((await listRecipes(a.owner, "?active=all")).body.recipes).toEqual([]);
    });

    it("the real import creates them, and the export equals the JSON fixture", async () => {
      const done = await importRecipes(a.admin, { format: "csv", csv: demoCsv });
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ dryRun: false, created: 3, newVersions: 0, unchanged: 0 });
      for (const recipe of (await listRecipes(a.owner)).body.recipes)
        keys.set(recipe.name, recipe.key);
      expect([...keys.keys()].sort()).toEqual([
        "Polenta (demo)",
        "Spezzatino (demo)",
        "Spezzatino con polenta (demo)",
      ]);

      const exported = await exportRecipes(a.admin);
      expect(exported.status).toBe(200);
      expect(exported.body).toEqual(demoJson);
    });

    it("importing the JSON fixture again changes nothing", async () => {
      const again = await importRecipes(a.admin, { format: "json", recipes: demoJson.recipes });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ created: 0, newVersions: 0, unchanged: 3 });
      expect(await count(a, "recipe_key")).toBe(3);
      expect(await count(a, "recipe")).toBe(3);
    });

    it("only the owner and the admin import or export", async () => {
      for (const user of [a.chef, a.waiter]) {
        expect((await importRecipes(user, { format: "csv", csv: demoCsv })).status).toBe(403);
        expect((await exportRecipes(user)).status).toBe(403);
      }
      expect((await exportRecipes(a.owner)).status).toBe(200);
    });

    it("a file with a row error is refused with its line and nothing is written", async () => {
      const broken = demoCsv.replace(
        "Polenta (demo);sottoricetta;1;kg",
        "Polenta (demo);menu;1;kg",
      );
      const refused = await importRecipes(a.admin, { format: "csv", csv: broken });
      expect(refused.status).toBe(422);
      expect(refused.error.code).toBe("import_invalid");
      expect(refused.error.details).toEqual([{ row: 2, field: "tipo", code: "invalid_value" }]);
    });

    it("an unknown ingredient in a file is refused by the database with its row, and nothing changes", async () => {
      const unknown = demoCsv.replace("Pane (demo)", "Pane sconosciuto (demo)");
      const refused = await importRecipes(a.admin, { format: "csv", csv: unknown });
      expect(refused.status).toBe(422);
      expect(refused.error.code).toBe("recipe_invalid");
      expect(refused.error.details).toContainEqual(
        expect.objectContaining({ code: "unknown_ingredient" }),
      );
      expect(await count(a, "recipe")).toBe(3);
    });
  });

  describe("AT1 an edit is a new version; version 1 never changes", () => {
    it("the chef saves version 2 of the stew with a new shelf life", async () => {
      const stew = keys.get("Spezzatino (demo)")!;
      const before = (await getRecipe(a.chef, stew)).body.recipe;
      expect(before).toMatchObject({ version: 1, shelfLifeHours: 72, isCurrent: true });

      const saved = await newVersion(a.chef, stew, {
        baseVersion: 1,
        ...contentOf(before, { shelfLifeHours: 48 }),
      });
      expect(saved.status).toBe(201);
      expect(saved.body.recipe).toMatchObject({ version: 2, shelfLifeHours: 48, isCurrent: true });
    });

    it("version 1 is still readable and unchanged, with an earlier valid_from", async () => {
      const stew = keys.get("Spezzatino (demo)")!;
      const first = (await getVersion(a.owner, stew, 1)).body.recipe;
      const second = (await getVersion(a.owner, stew, 2)).body.recipe;
      expect(first).toMatchObject({ version: 1, shelfLifeHours: 72, isCurrent: false });
      expect(first.lines).toEqual(second.lines);
      expect(Date.parse(second.validFrom)).toBeGreaterThan(Date.parse(first.validFrom));
      expect(second.versions.map((v) => v.version)).toEqual([2, 1]);
    });

    it("a stale edit from version 1 is 409 with the current version", async () => {
      const stew = keys.get("Spezzatino (demo)")!;
      const current = (await getRecipe(a.owner, stew)).body.recipe;
      const stale = await newVersion(a.owner, stew, {
        baseVersion: 1,
        ...contentOf(current, { shelfLifeHours: 24 }),
      });
      expect(stale.status).toBe(409);
      expect(stale.error.code).toBe("version_conflict");
      expect(stale.error.details).toEqual([{ currentVersion: 2 }]);
    });

    it("a body that changes nothing is 422 recipe_unchanged", async () => {
      const stew = keys.get("Spezzatino (demo)")!;
      const current = (await getRecipe(a.owner, stew)).body.recipe;
      const same = await newVersion(a.owner, stew, { baseVersion: 2, ...contentOf(current) });
      expect(same.status).toBe(422);
      expect(same.error.code).toBe("recipe_unchanged");
    });

    it("a direct update of a version row is refused: no grant", async () => {
      const stew = keys.get("Spezzatino (demo)")!;
      const { data } = await a.owner.client
        .from("recipe")
        .select("id")
        .eq("recipe_key", stew)
        .eq("version", 1)
        .single();
      const update = await a.owner.client
        .from("recipe")
        .update({ name: "Altro" })
        .eq("id", data!.id);
      expect(update.error?.code).toBe("42501");
      const remove = await a.owner.client.from("recipe").delete().eq("id", data!.id);
      expect(remove.error?.code).toBe("42501");
      expect((await getVersion(a.owner, stew, 1)).body.recipe.name).toBe("Spezzatino (demo)");
    });
  });

  describe("AT2 a loop of sub-recipes is refused", () => {
    it("A uses B, then B using A is 422 recipe_cycle and B stays at version 1", async () => {
      const flour = ingredientIds.get("Farina di mais (demo)")!;
      const subA = await createRecipe(a.owner, {
        type: "sub",
        name: "Sugo A (demo)",
        outputQty: 1,
        outputUnit: "kg",
        lines: [{ ingredientId: flour, qty: 1, unit: "kg" }],
      });
      expect(subA.status).toBe(201);
      keys.set("Sugo A (demo)", subA.body.recipe.key);
      const subB = await createRecipe(a.owner, {
        type: "sub",
        name: "Sugo B (demo)",
        outputQty: 1,
        outputUnit: "kg",
        lines: [{ recipeKey: subA.body.recipe.key, qty: 1, unit: "kg" }],
      });
      expect(subB.status).toBe(201);
      keys.set("Sugo B (demo)", subB.body.recipe.key);

      // Now A would use B: A -> B -> A.
      const loop = await newVersion(a.owner, subA.body.recipe.key, {
        baseVersion: 1,
        ...contentOf(subA.body.recipe, {
          lines: [
            { ingredientId: flour, qty: 1, unit: "kg" },
            { recipeKey: subB.body.recipe.key, qty: 1, unit: "kg" },
          ],
        }),
      });
      expect(loop.status).toBe(422);
      expect(loop.error.code).toBe("recipe_cycle");
      expect(loop.error.message).toContain("sottoricetta");
      expect((await getRecipe(a.owner, subA.body.recipe.key)).body.recipe.version).toBe(1);
    });

    it("a recipe that uses itself is 422 too", async () => {
      const subA = (await getRecipe(a.owner, keys.get("Sugo A (demo)")!)).body.recipe;
      const self = await newVersion(a.owner, subA.key, {
        baseVersion: 1,
        ...contentOf(subA, { lines: [{ recipeKey: subA.key, qty: 1, unit: "kg" }] }),
      });
      expect(self.status).toBe(422);
      expect(self.error.code).toBe("recipe_cycle");
    });
  });

  describe("AT3 a yield of zero or below is refused", () => {
    const body = (yieldFactor: number) => ({
      type: "sub",
      name: "Prova resa (demo)",
      outputQty: 1,
      outputUnit: "kg",
      lines: [
        {
          ingredientId: ingredientIds.get("Manzo muscolo (demo)")!,
          qty: 1,
          unit: "kg",
          yieldFactor,
        },
      ],
    });

    it.each([0, -1])("yield %i is 422 recipe_invalid", async (yieldFactor) => {
      const reply = await createRecipe(a.owner, body(yieldFactor));
      expect(reply.status).toBe(422);
      expect(reply.error.code).toBe("recipe_invalid");
      expect(reply.error.details).toEqual([
        { field: "lines.0.yieldFactor", code: "yield_factor_not_positive" },
      ]);
    });

    it("1.5 is accepted with a warning, and nothing was left by the refused attempts", async () => {
      const reply = await createRecipe(a.owner, body(1.5));
      expect(reply.status).toBe(201);
      expect(reply.body.warnings).toEqual([{ line: 1, code: "yield_above_one" }]);
      expect(reply.body.recipe.lines[0]!.warnings).toEqual(["yield_above_one"]);
      const named = (await listRecipes(a.owner)).body.recipes.filter(
        (r) => r.name === "Prova resa (demo)",
      );
      expect(named).toHaveLength(1);
    });
  });

  describe("AT5 the chef reads the price and never sets it", () => {
    it("the chef reads the menu price and the target GP% and nothing in euros of cost", async () => {
      const plate = await getRecipe(a.chef, keys.get("Spezzatino con polenta (demo)")!);
      expect(plate.status).toBe(200);
      expect(plate.body.recipe.pricing).toEqual({ salePrice: 12, targetGpPct: 70 });
      expect(plate.body.recipe.canEditPrice).toBe(false);
      expect(JSON.stringify(plate.body)).not.toMatch(/cost|margin/i);
    });

    it("a chef version that names the price is 403, even with the stored value", async () => {
      const plateKey = keys.get("Spezzatino con polenta (demo)")!;
      const plate = (await getRecipe(a.chef, plateKey)).body.recipe;
      for (const price of [{ salePrice: 12 }, { salePrice: 15 }, { targetGpPct: 70 }]) {
        const refused = await newVersion(a.chef, plateKey, {
          baseVersion: 1,
          ...contentOf(plate),
          ...price,
        });
        expect(refused.status).toBe(403);
        expect(refused.error.code).toBe("recipe_price_forbidden");
      }
      expect((await getRecipe(a.owner, plateKey)).body.recipe.version).toBe(1);
    });

    it("the owner sets a new price in version 2; version 1 keeps 12", async () => {
      const plateKey = keys.get("Spezzatino con polenta (demo)")!;
      const plate = (await getRecipe(a.owner, plateKey)).body.recipe;
      const saved = await newVersion(a.owner, plateKey, {
        baseVersion: 1,
        ...contentOf(plate),
        salePrice: 13,
      });
      expect(saved.status).toBe(201);
      expect(saved.body.recipe.pricing).toEqual({ salePrice: 13, targetGpPct: 70 });
      expect((await getVersion(a.owner, plateKey, 1)).body.recipe.pricing).toEqual({
        salePrice: 12,
        targetGpPct: 70,
      });
    });

    it("a chef version of the plate without price keys copies the price", async () => {
      const plateKey = keys.get("Spezzatino con polenta (demo)")!;
      const plate = (await getRecipe(a.chef, plateKey)).body.recipe;
      const line = { ...contentOf(plate).lines[1]!, qty: 0.25 };
      const lines = contentOf(plate).lines.map((l, i) => (i === 1 ? line : l));
      const saved = await newVersion(a.chef, plateKey, {
        baseVersion: 2,
        ...contentOf(plate, { lines }),
      });
      expect(saved.status).toBe(201);
      expect(saved.body.recipe).toMatchObject({
        version: 3,
        pricing: { salePrice: 13, targetGpPct: 70 },
      });
    });

    it("the chef reads recipe_price directly but cannot write it; the waiter reads nothing", async () => {
      const read = await a.chef.client.from("recipe_price").select("sale_price, target_gp_pct");
      expect(read.error).toBeNull();
      expect(read.data!.length).toBeGreaterThan(0);
      expect(Object.keys(read.data![0]!).sort()).toEqual(["sale_price", "target_gp_pct"]);
      const write = await a.chef.client
        .from("recipe_price")
        .update({ sale_price: 1 })
        .gte("sale_price", 0);
      expect(write.error?.code).toBe("42501");
      const waiter = await a.waiter.client.from("recipe_price").select("*");
      expect(waiter.data).toEqual([]);
    });
  });

  describe("AT6 a blank allergen cell is unknown, not allergen-free", () => {
    it("the flour imported with a blank cell is unknown", async () => {
      const { body } = await call<{
        ingredients: { name: string; allergens: string[] | null; allergenStatus: string }[];
      }>(a.owner, ingredientsRoute.GET as Handler, "/api/ingredients");
      const flour = body.ingredients.find((i) => i.name === "Farina di mais (demo)");
      expect(flour).toMatchObject({ allergens: null, allergenStatus: "unknown" });
    });

    it("the plate, through the polenta, is da confermare and names the flour; the stew is confirmed", async () => {
      const plate = (await getRecipe(a.owner, keys.get("Spezzatino con polenta (demo)")!)).body
        .recipe;
      expect(plate.allergens).toEqual({
        list: ["glutine"],
        status: "da_confermare",
        unconfirmedIngredients: [
          { id: ingredientIds.get("Farina di mais (demo)"), name: "Farina di mais (demo)" },
        ],
      });
      const stew = (await getRecipe(a.owner, keys.get("Spezzatino (demo)")!)).body.recipe;
      expect(stew.allergens.status).toBe("confirmed");
      const list = (await listRecipes(a.chef)).body.recipes;
      expect(list.find((r) => r.name === "Polenta (demo)")!.allergens.status).toBe("da_confermare");
    });

    it("admin, chef and waiter cannot confirm (Q6: owner only)", async () => {
      const flour = ingredientIds.get("Farina di mais (demo)")!;
      for (const user of [a.admin, a.chef, a.waiter]) {
        expect((await confirmAllergens(user, flour, [])).status, user.role).toBe(403);
      }
      const plate = (await getRecipe(a.owner, keys.get("Spezzatino con polenta (demo)")!)).body
        .recipe;
      expect(plate.allergens.status).toBe("da_confermare");
    });

    it("the owner confirms the flour as none and the plate becomes confirmed", async () => {
      const confirmed = await confirmAllergens(
        a.owner,
        ingredientIds.get("Farina di mais (demo)")!,
        [],
      );
      expect(confirmed.status).toBe(200);
      const plate = (await getRecipe(a.owner, keys.get("Spezzatino con polenta (demo)")!)).body
        .recipe;
      expect(plate.allergens).toEqual({
        list: ["glutine"],
        status: "confirmed",
        unconfirmedIngredients: [],
      });
    });
  });

  describe("waiters and tenancy", () => {
    it("the waiter gets 403 from every recipe route and reads no recipe row", async () => {
      const key = keys.get("Spezzatino (demo)")!;
      expect((await listRecipes(a.waiter)).status).toBe(403);
      expect((await getRecipe(a.waiter, key)).status).toBe(403);
      expect((await getVersion(a.waiter, key, 1)).status).toBe(403);
      expect((await createRecipe(a.waiter, { type: "sub", name: "X", lines: [] })).status).toBe(
        403,
      );
      expect(
        (await newVersion(a.waiter, key, { baseVersion: 2, name: "X", lines: [] })).status,
      ).toBe(403);
      for (const table of ["recipe_key", "recipe", "recipe_line", "recipe_price"]) {
        const { data, error } = await a.waiter.client.from(table).select("*");
        expect(error, table).toBeNull();
        expect(data, table).toEqual([]);
      }
    });

    it("tenant B sees none of tenant A's recipes and gets 404 on A's keys", async () => {
      const key = keys.get("Spezzatino (demo)")!;
      expect((await listRecipes(b.owner, "?active=all")).body.recipes).toEqual([]);
      expect((await getRecipe(b.owner, key)).status).toBe(404);
      expect((await getVersion(b.owner, key, 1)).status).toBe(404);
      expect(
        (await newVersion(b.owner, key, { baseVersion: 2, name: "X", lines: [] })).status,
      ).toBe(404);
      for (const table of ["recipe_key", "recipe", "recipe_line", "recipe_price"]) {
        expect(await count(b, table), table).toBe(0);
      }
      expect((await exportRecipes(b.admin)).body.recipes).toEqual([]);
    });
  });
});
