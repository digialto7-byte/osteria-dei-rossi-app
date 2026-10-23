import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/suppliers/[id]/statement/route");

const SUP = "5d000000-0000-4000-8000-00000000005d";
const URL_ = `http://localhost:3000/api/suppliers/${SUP}/statement`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const STATEMENT = {
  supplier: { id: SUP, name: "Fornitore Demo Tre", vatNumber: "IT00000000000" },
  asOf: "2026-10-23",
  invoices: [],
  credits: [],
  totals: { invoicesTotal: 1800, creditsTotal: 70, balance: 1730, disputedAmount: 280 },
};

function as(
  role: string,
  rpc: Record<string, FakeResult[]> = { supplier_statement: [ok(STATEMENT)] },
) {
  client = fakeSupabase({ claims: claimsFor(role), rpc });
}
beforeEach(() => as("owner"));
const get = (id = SUP) => route.GET(new Request(URL_), routeContext({ id }));

describe("GET /api/suppliers/:id/statement", () => {
  it("returns the statement as the database built it", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(STATEMENT);
    expect(client.rpc).toHaveBeenCalledWith("supplier_statement", { p_supplier: SUP });
  });

  it("owner and admin may read it", async () => {
    as("admin");
    expect((await get()).status).toBe(200);
  });

  it("chef and waiter get 403 before any RPC (AT6)", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await get()).status).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
  });

  it("a malformed id is a 404 without any RPC", async () => {
    expect((await get("nope")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0002 is a 404 and 42501 a 403", async () => {
    as("owner", {
      supplier_statement: [{ data: null, error: { code: "P0002", message: "not_found" } }],
    });
    expect((await get()).status).toBe(404);
    as("owner", {
      supplier_statement: [
        { data: null, error: { code: "42501", message: "insufficient_privilege" } },
      ],
    });
    expect((await get()).status).toBe(403);
  });
});
