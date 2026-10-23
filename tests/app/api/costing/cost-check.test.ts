import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const route = await import("@/app/api/admin/cost-check/route");
const { MAX_COST_CHECK_CHARS } = await import("@/server/costing/constants");

const URL_ = "http://localhost:3000/api/admin/cost-check";
const CSV = readFileSync(join(__dirname, "../../../fixtures/costing/foglio-chef-demo.csv"), "utf8");
const ok = (data: unknown): FakeResult => ({ data, error: null });

const key = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const plate = (n: number, name: string, food: number | null) => ({
  recipe_key: key(n),
  name,
  version: 1,
  food_cost_eur: food,
  status: food === null ? "incomplete" : "ok",
  missing_ingredient_ids: [],
});
// Food costs of the AT9 fixture against the sheet's 10,00 each: +6 %, +4 %, -6 %, +5 %.
const PLATES = [
  plate(1, "Tagliata (demo)", 10.6),
  plate(2, "Brasato (demo)", 10.4),
  plate(3, "Ragù (demo)", 9.4),
  plate(4, "Arrosto (demo)", 10.5),
  plate(5, "Tiramisù (demo)", 3.5),
];

function as(role: string, plates: unknown = PLATES) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { plate_costs: [ok(plates)] } });
}
beforeEach(() => as("owner"));

const post = (body: unknown, init: RequestInit = {}) => route.POST(jsonRequest(URL_, body, init));

describe("POST /api/admin/cost-check (AT9)", () => {
  it("owner and admin get the comparison: 6 % listed, 4 % and exactly 5 % not", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      const response = await post({ format: "csv", csv: CSV });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.tolerancePct).toBe(5);
      expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.compared).toBe(4);
      expect(body.withinTolerance).toBe(2);
      expect(
        body.listed.map((p: { name: string; diffPct: number }) => [p.name, p.diffPct]),
      ).toEqual([
        ["Tagliata (demo)", 6],
        ["Ragù (demo)", -6],
      ]);
      expect(body.unmatched).toEqual([{ row: 6, name: "Piatto fantasma (demo)" }]);
      expect(body.duplicates).toEqual([
        { row: 7, name: "Tiramisù (demo)" },
        { row: 8, name: "Tiramisù (demo)" },
      ]);
    }
  });

  it("reads plate_costs once and nothing else: nothing is written", async () => {
    await post({ format: "csv", csv: CSV });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("plate_costs", { p_date: null });
    expect(client.query.insert).not.toHaveBeenCalled();
    expect(client.query.update).not.toHaveBeenCalled();
    expect(client.query.upsert).not.toHaveBeenCalled();
  });

  it("accepts the JSON form", async () => {
    const response = await post({
      format: "json",
      plates: [{ name: "Tagliata (demo)", foodCostEur: 10 }],
    });
    expect(response.status).toBe(200);
    expect((await response.json()).listed).toHaveLength(1);
  });

  it("reports an incomplete plate by name and key", async () => {
    as("owner", [plate(1, "Tagliata (demo)", null)]);
    const body = await (
      await post({ format: "csv", csv: "piatto;costo_cibo\nTagliata (demo);10\n" })
    ).json();
    expect(body.incomplete).toEqual([{ row: 2, name: "Tagliata (demo)", recipeKey: key(1) }]);
  });

  it("chef and waiter get 403 before any RPC", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await post({ format: "csv", csv: CSV })).status).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("row errors are a 422 import_invalid with file rows and codes only, and no RPC", async () => {
    const csv = "piatto;costo_cibo\nSegretissimo Brasato;=SUM(A1)\nB;abc\n";
    const response = await post({ format: "csv", csv });
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("import_invalid");
    expect(error.details).toEqual([
      { row: 2, field: "costo_cibo", code: "invalid_value" },
      { row: 3, field: "costo_cibo", code: "invalid_value" },
    ]);
    expect(JSON.stringify(error)).not.toContain("Segretissimo");
    expect(JSON.stringify(error)).not.toContain("SUM");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("413 for a body over the character limit, by length or by Content-Length", async () => {
    const big = "x".repeat(MAX_COST_CHECK_CHARS + 1);
    expect((await post({ format: "csv", csv: big })).status).toBe(413);
    const declared = await post(
      { format: "csv", csv: "a" },
      { headers: { "content-type": "application/json", "content-length": "9999999" } },
    );
    expect(declared.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("413 for more than 500 rows", async () => {
    const csv = "piatto;costo_cibo\n" + Array.from({ length: 501 }, (_, i) => `P${i};1`).join("\n");
    expect((await post({ format: "csv", csv })).status).toBe(413);
  });

  it("400 for a wrong shape, 415 for text/plain", async () => {
    expect((await post({ format: "xml" })).status).toBe(400);
    expect((await post({ format: "csv", csv: "a", extra: 1 })).status).toBe(400);
    expect((await post("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
  });

  it("maps a database error from plate_costs", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { plate_costs: [{ data: null, error: { code: "42501", message: "denied" } }] },
    });
    expect((await post({ format: "csv", csv: CSV })).status).toBe(403);
  });
});
