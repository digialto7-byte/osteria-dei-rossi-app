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
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/batches/[id]/label/route");

const BATCH = "ba000000-0000-4000-8000-0000000000b1";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const LABEL = {
  batchId: BATCH,
  recipeName: "Spezzatino (demo)",
  version: 1,
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2026-10-26T10:00:00+00:00",
  portions: 31,
  lotCode: "261023-SPEZZA-1",
  operatorInitials: "CD",
  shelfLifeHours: 72,
  portionsRemaining: 31,
  splitFrom: null,
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { batch_label: [ok(LABEL)], ...rpc } });
}
beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

const get = (id: string = BATCH) =>
  route.GET(new Request(`http://localhost:3000/api/batches/${id}/label`), routeContext({ id }));

describe("GET /api/batches/:id/label", () => {
  it("owner, admin and chef get the label keys only", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await get();
      expect(response.status, role).toBe(200);
      expect(await response.json()).toEqual(LABEL);
      expect(client.rpc).toHaveBeenCalledWith("batch_label", { p_batch: BATCH });
    }
  });

  it("the waiter gets 403 before any RPC, and no session is 401", async () => {
    as("waiter");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
  });

  it("a malformed id is a 404 without an RPC", async () => {
    expect((await get("nope")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an unknown or foreign batch (P0002) is a 404", async () => {
    as("chef", { batch_label: [failure("P0002", "batch_not_found")] });
    const response = await get();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("drops an extra field the RPC reply carries", async () => {
    as("chef", { batch_label: [ok({ ...LABEL, total_cost: 53.5167 })] });
    const text = await (await get()).text();
    expect(text).not.toContain("total_cost");
  });

  it("an unexpected database error is a 500 that reports the SQLSTATE only", async () => {
    as("chef", { batch_label: [failure("XX000", "boom SEGRETO")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
  });
});
