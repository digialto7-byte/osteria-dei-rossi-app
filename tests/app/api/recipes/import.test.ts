import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMPORT_BODY_BYTES } from "@/server/master/import";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const importRoute = await import("@/app/api/admin/import/recipes/route");
const exportRoute = await import("@/app/api/admin/export/recipes/route");

const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/import/${name}`, import.meta.url), "utf8");
const demoCsv = fixture("ricette-demo.csv");
const demoJson = (JSON.parse(fixture("ricette-demo.json")) as { recipes: object[] }).recipes;
const IMPORT_URL = "http://localhost:3000/api/admin/import/recipes";
const EXPORT_URL = "http://localhost:3000/api/admin/export/recipes";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const PREVIEW = {
  dryRun: true,
  created: 3,
  newVersions: 0,
  unchanged: 0,
  recipes: [
    { row: 2, name: "Polenta (demo)", action: "create", version: 1, warnings: [] },
    { row: 3, name: "Spezzatino (demo)", action: "create", version: 1, warnings: [] },
    {
      row: 4,
      name: "Spezzatino con polenta (demo)",
      action: "create",
      version: 1,
      warnings: [{ line: 2, code: "yield_above_one" }],
    },
  ],
};

function as(role: string, rpc: Record<string, FakeResult[]> = { import_recipes: [ok(PREVIEW)] }) {
  client = fakeSupabase({ claims: claimsFor(role), rpc });
}
beforeEach(() => as("owner"));

const send = (body: unknown, init?: RequestInit) =>
  importRoute.POST(jsonRequest(IMPORT_URL, body, init));

describe("POST /api/admin/import/recipes", () => {
  it.each(["owner", "admin"])(
    "%s previews the demo CSV through the procedure with p_dry_run true",
    async (role) => {
      as(role);
      const response = await send({ format: "csv", csv: demoCsv, dryRun: true });
      expect(response.status).toBe(200);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      const [name, args] = client.rpc.mock.calls[0]!;
      expect(name).toBe("import_recipes");
      expect(args).toMatchObject({ p_dry_run: true });
      expect(
        (args as { p_rows: { row: number; name: string }[] }).p_rows.map((r) => [r.row, r.name]),
      ).toEqual([
        [2, "Polenta (demo)"],
        [3, "Spezzatino (demo)"],
        [4, "Spezzatino con polenta (demo)"],
      ]);
      expect(await response.json()).toEqual(PREVIEW);
    },
  );

  it("sends the JSON rows as they are and imports for real when dryRun is absent or false", async () => {
    for (const extra of [{}, { dryRun: false }]) {
      as("owner", { import_recipes: [ok({ ...PREVIEW, dryRun: false })] });
      const response = await send({ format: "json", recipes: demoJson, ...extra });
      expect(response.status).toBe(200);
      expect(client.rpc.mock.calls[0]![1]).toMatchObject({ p_dry_run: false });
      expect((await response.json()).dryRun).toBe(false);
    }
  });

  it.each(["chef", "waiter"])("%s gets 403 before any procedure call", async (role) => {
    as(role);
    expect((await send({ format: "csv", csv: demoCsv })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller gets 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await send({ format: "csv", csv: demoCsv })).status).toBe(401);
  });

  it("CSV with row errors is 422 import_invalid with file lines and no procedure call", async () => {
    const csv = demoCsv.replace("Polenta (demo);sottoricetta;1;kg", "Polenta (demo);menu;1;t");
    const response = await send({ format: "csv", csv });
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("import_invalid");
    expect(error.details).toEqual([
      { row: 2, field: "tipo", code: "invalid_value" },
      { row: 2, field: "uscita_unita", code: "invalid_unit" },
    ]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("JSON with row errors is 422 import_invalid by position", async () => {
    const response = await send({
      format: "json",
      recipes: [{ name: "X", type: "plate", extra: 1, lines: [] }],
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toEqual([
      { row: 1, field: "extra", code: "unknown_column" },
    ]);
  });

  it("error details carry row, field and code, never cell contents", async () => {
    const csv = demoCsv.replace("Pane (demo);;1;pz;1", "Pane (demo);;uno;pz;1");
    const response = await send({ format: "csv", csv });
    const text = JSON.stringify(await response.json());
    expect(text).toContain("invalid_number");
    expect(text).not.toContain("Pane (demo)");
    expect(text).not.toContain("Spezzatino");
  });

  it("a body over MAX_IMPORT_BODY_BYTES is 413 before it is read", async () => {
    const response = await send(
      { format: "csv", csv: "x" },
      {
        headers: {
          "content-type": "application/json",
          "content-length": String(MAX_IMPORT_BODY_BYTES + 1),
        },
      },
    );
    expect(response.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses an unknown key (400), a non-JSON body (415) and more than 1 000 JSON recipes (400)", async () => {
    expect((await send({ format: "csv", csv: demoCsv, extra: 1 })).status).toBe(400);
    const text = new Request(IMPORT_URL, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
    });
    expect((await importRoute.POST(text)).status).toBe(415);
    const many = Array.from({ length: 1001 }, () => ({}));
    expect((await send({ format: "json", recipes: many })).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps the procedure's errors with the file row: cycle, type conflict, inactive, unknown ingredient", async () => {
    const cases: [string, string, number, string][] = [
      ["recipe_cycle", "a,b,a", 422, "recipe_cycle"],
      [
        "recipe_type_conflict",
        '[{"row":3,"field":"type","code":"recipe_type_conflict"}]',
        422,
        "recipe_type_conflict",
      ],
      [
        "recipe_inactive",
        '[{"row":4,"field":"name","code":"recipe_inactive"}]',
        409,
        "recipe_inactive",
      ],
      [
        "recipe_invalid",
        '[{"row":2,"field":"lines.0.ingredient","code":"unknown_ingredient"}]',
        422,
        "recipe_invalid",
      ],
    ];
    for (const [message, details, status, code] of cases) {
      as("admin", { import_recipes: [failure("P0001", message, details)] });
      const response = await send({ format: "csv", csv: demoCsv });
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    as("admin", {
      import_recipes: [
        failure(
          "P0001",
          "recipe_invalid",
          '[{"row":2,"field":"lines.0.ingredient","code":"unknown_ingredient"}]',
        ),
      ],
    });
    const { error } = await (await send({ format: "csv", csv: demoCsv })).json();
    expect(error.details).toEqual([
      { row: 2, field: "lines.0.ingredient", code: "unknown_ingredient" },
    ]);
  });

  it("an unknown database error is 500 without the message", async () => {
    as("owner", { import_recipes: [failure("XX000", "Pane (demo) secret")] });
    const response = await send({ format: "csv", csv: demoCsv });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Pane");
  });
});

describe("GET /api/admin/export/recipes", () => {
  const EXPORT = { recipes: demoJson };

  it.each(["owner", "admin"])("%s gets the recipes in the template shape", async (role) => {
    as(role, { export_recipes: [ok(EXPORT)] });
    const response = await exportRoute.GET(new Request(EXPORT_URL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EXPORT);
    expect(client.rpc).toHaveBeenCalledWith("export_recipes");
  });

  it.each(["chef", "waiter"])("%s gets 403 before any procedure call", async (role) => {
    as(role, { export_recipes: [ok(EXPORT)] });
    expect((await exportRoute.GET(new Request(EXPORT_URL))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an empty tenant exports an empty list; a database refusal maps to 403", async () => {
    as("owner", { export_recipes: [ok(null)] });
    expect(await (await exportRoute.GET(new Request(EXPORT_URL))).json()).toEqual({ recipes: [] });
    as("owner", { export_recipes: [failure("42501", "permission denied")] });
    expect((await exportRoute.GET(new Request(EXPORT_URL))).status).toBe(403);
  });

  it("a file imported from the export parses to the same recipes (round trip through the template)", async () => {
    const { recipeRowsFromJson } = await import("@/server/recipes/import-template");
    const { rows } = recipeRowsFromJson(EXPORT.recipes);
    expect(rows.map(({ row: _row, ...rest }) => rest)).toEqual(EXPORT.recipes);
  });
});
