import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/observability/report";
import { OFFLINE_CACHE_PATHS } from "@/lib/api/offline-cache";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  IDS,
  LOT_CAPTURE,
  TRACE_BATCH_CHEF,
  TRACE_BATCH_OWNER,
  TRACE_LINES,
  TRACE_LOT_CHEF,
  TRACE_LOT_OWNER,
  TRACE_LOT_SEARCH,
  TRACE_ORDER_LINE_CHEF,
  TRACE_ORDER_LINE_OWNER,
} from "../../helpers/trace-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const lots = await import("@/app/api/trace/lots/route");
const lot = await import("@/app/api/trace/lots/[id]/route");
const capture = await import("@/app/api/trace/capture/route");
const batch = await import("@/app/api/trace/batches/[id]/route");
const lines = await import("@/app/api/trace/lines/route");
const line = await import("@/app/api/trace/lines/[id]/route");

const BASE = "http://localhost:3000/api/trace";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

type Handler = (r: Request, c?: ReturnType<typeof routeContext>) => Promise<Response>;
function as(role: string, rpc: Record<string, FakeResult>) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: Object.fromEntries(Object.entries(rpc).map(([k, v]) => [k, [v]])),
  });
}
const call = (route: { GET: unknown }, path: string, id?: string) =>
  (route.GET as Handler)(
    new Request(`${BASE}${path}`),
    id === undefined ? undefined : routeContext({ id }),
  );

beforeEach(() => vi.mocked(reportError).mockClear());

describe("GET /api/trace/lots (search)", () => {
  it.each(["owner", "admin", "chef"])("%s: one RPC with the typed filters only", async (role) => {
    as(role, { trace_lot_search: ok(TRACE_LOT_SEARCH) });
    const response = await call(lots, "/lots?q=L-DEMO&from=1998-11-01");
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("trace_lot_search", {
      p_q: "L-DEMO",
      p_ingredient: null,
      p_supplier: null,
      p_from: "1998-11-01",
      p_to: null,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("ingredient and supplier filters are passed on", async () => {
    as("owner", { trace_lot_search: ok(TRACE_LOT_SEARCH) });
    await call(lots, `/lots?ingredientId=${IDS.ingredient}&supplierId=${IDS.supplier}`);
    expect(client.rpc).toHaveBeenCalledWith("trace_lot_search", {
      p_q: null,
      p_ingredient: IDS.ingredient,
      p_supplier: IDS.supplier,
      p_from: null,
      p_to: null,
    });
  });

  it("a waiter gets 403 and a signed-out caller 401, with no RPC", async () => {
    as("waiter", { trace_lot_search: ok(TRACE_LOT_SEARCH) });
    expect((await call(lots, "/lots?q=x")).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    as("none", { trace_lot_search: ok(TRACE_LOT_SEARCH) });
    expect((await call(lots, "/lots?q=x")).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no filter", "/lots"],
    ["only dates", "/lots?from=1998-11-01&to=1998-11-14"],
    ["a 65 character q", `/lots?q=${"a".repeat(65)}`],
    ["an empty q", "/lots?q="],
    ["a bad uuid", "/lots?ingredientId=nope"],
    ["a bad date", "/lots?q=x&from=1998-13-01"],
    ["an unknown key", "/lots?q=x&role=owner"],
    ["a repeated key", "/lots?q=a&q=b"],
  ])("%s is a 400 with no RPC", async (_n, path) => {
    as("owner", { trace_lot_search: ok(TRACE_LOT_SEARCH) });
    expect((await call(lots, path)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["date_in_future", "P0001", 422],
    ["range_too_long", "P0001", 422],
    ["query_invalid", "22023", 400],
  ])("%s maps to %i without the database message", async (message, code, status) => {
    as("owner", { trace_lot_search: failure(code, message) });
    const response = await call(lots, "/lots?q=SECRET-LOT");
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("SECRET-LOT");
  });

  it("a reply with an extra key is a 500", async () => {
    as("chef", {
      trace_lot_search: ok({
        ...TRACE_LOT_SEARCH,
        lots: [{ ...TRACE_LOT_SEARCH.lots[0]!, unitCost: 1 }],
      }),
    });
    expect((await call(lots, "/lots?q=x")).status).toBe(500);
  });
});

describe("GET /api/trace/capture", () => {
  it("answers the capture rate with the dates passed on", async () => {
    as("chef", { lot_capture: ok(LOT_CAPTURE) });
    const response = await call(capture, "/capture?from=1998-10-16&to=1998-11-14");
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("lot_capture", {
      p_from: "1998-10-16",
      p_to: "1998-11-14",
    });
  });

  it("no dates: nulls; waiter 403; bad date 400; range_too_long 422", async () => {
    as("owner", { lot_capture: ok(LOT_CAPTURE) });
    await call(capture, "/capture");
    expect(client.rpc).toHaveBeenCalledWith("lot_capture", { p_from: null, p_to: null });
    expect((await call(capture, "/capture?from=x")).status).toBe(400);
    as("waiter", { lot_capture: ok(LOT_CAPTURE) });
    expect((await call(capture, "/capture")).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    as("owner", { lot_capture: failure("P0001", "range_too_long") });
    expect((await call(capture, "/capture")).status).toBe(422);
  });
});

describe("GET /api/trace/lots/[id]", () => {
  it("the owner's reply with invoice and purchase passes", async () => {
    as("owner", { trace_lot: ok(TRACE_LOT_OWNER) });
    const response = await call(lot, `/lots/${IDS.lot}`, IDS.lot);
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("trace_lot", { p_lot: IDS.lot });
    const body = (await response.json()) as typeof TRACE_LOT_OWNER;
    expect(body.lot.invoice.number).toBe("FT-DEMO-1");
    expect(body.lot.purchase.supplierCode).toBe("FD-1");
  });

  it("the chef's reply without them passes", async () => {
    as("chef", { trace_lot: ok(TRACE_LOT_CHEF) });
    const response = await call(lot, `/lots/${IDS.lot}`, IDS.lot);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/invoice|purchase/);
  });

  it.each(["invoice", "purchase"])("a chef reply that carries %s is a 500", async (key) => {
    const extra = TRACE_LOT_OWNER.lot[key as "invoice" | "purchase"];
    as("chef", {
      trace_lot: ok({ ...TRACE_LOT_CHEF, lot: { ...TRACE_LOT_CHEF.lot, [key]: extra } }),
    });
    const response = await call(lot, `/lots/${IDS.lot}`, IDS.lot);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("FT-DEMO-1");
  });

  it("an owner reply missing the invoice is a 500", async () => {
    as("owner", { trace_lot: ok(TRACE_LOT_CHEF) });
    expect((await call(lot, `/lots/${IDS.lot}`, IDS.lot)).status).toBe(500);
  });

  it("a malformed id is a 404 with no RPC; a waiter a 403 with no RPC", async () => {
    as("owner", { trace_lot: ok(TRACE_LOT_OWNER) });
    expect((await call(lot, "/lots/not-a-uuid", "not-a-uuid")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
    as("waiter", { trace_lot: ok(TRACE_LOT_OWNER) });
    expect((await call(lot, `/lots/${IDS.lot}`, IDS.lot)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0002 is a 404, 42501 a 403, trace_depth_exceeded a 422", async () => {
    as("owner", { trace_lot: failure("P0002", "not_found") });
    expect((await call(lot, `/lots/${IDS.lot}`, IDS.lot)).status).toBe(404);
    as("owner", { trace_lot: failure("42501", "permission denied") });
    expect((await call(lot, `/lots/${IDS.lot}`, IDS.lot)).status).toBe(403);
    as("owner", { trace_lot: failure("P0001", "trace_depth_exceeded") });
    expect((await call(lot, `/lots/${IDS.lot}`, IDS.lot)).status).toBe(422);
  });
});

describe("GET /api/trace/batches/[id]", () => {
  it("owner and chef replies pass with their own schema", async () => {
    as("owner", { trace_batch: ok(TRACE_BATCH_OWNER) });
    const owner = await call(batch, `/batches/${IDS.child}`, IDS.child);
    expect(owner.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("trace_batch", { p_batch: IDS.child });
    as("chef", { trace_batch: ok(TRACE_BATCH_CHEF) });
    const chef = await call(batch, `/batches/${IDS.child}`, IDS.child);
    expect(chef.status).toBe(200);
    expect(JSON.stringify(await chef.json())).not.toContain("invoice");
  });

  it("a chef reply with an invoice on an input lot is a 500", async () => {
    as("chef", { trace_batch: ok(TRACE_BATCH_OWNER) });
    expect((await call(batch, `/batches/${IDS.child}`, IDS.child)).status).toBe(500);
  });

  it("errors: malformed 404 with no RPC, depth 422, not found 404", async () => {
    as("owner", { trace_batch: failure("P0001", "trace_depth_exceeded") });
    expect((await call(batch, "/batches/x", "x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
    expect((await call(batch, `/batches/${IDS.batch}`, IDS.batch)).status).toBe(422);
    as("owner", { trace_batch: failure("P0002", "not_found") });
    expect((await call(batch, `/batches/${IDS.batch}`, IDS.batch)).status).toBe(404);
  });
});

describe("GET /api/trace/lines", () => {
  it("passes the day and the dish", async () => {
    as("chef", { trace_line_search: ok(TRACE_LINES) });
    const response = await call(lines, `/lines?date=1998-11-13&menuItemId=${IDS.menuItem}`);
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("trace_line_search", {
      p_date: "1998-11-13",
      p_menu_item: IDS.menuItem,
    });
  });

  it.each(["/lines", "/lines?date=13-11-1998", `/lines?date=1998-11-13&menuItemId=zz`])(
    "%s is a 400 with no RPC",
    async (path) => {
      as("owner", { trace_line_search: ok(TRACE_LINES) });
      expect((await call(lines, path)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("date_in_future is a 422; a waiter a 403", async () => {
    as("owner", { trace_line_search: failure("P0001", "date_in_future") });
    expect((await call(lines, "/lines?date=2999-01-01")).status).toBe(422);
    as("waiter", { trace_line_search: ok(TRACE_LINES) });
    expect((await call(lines, "/lines?date=1998-11-13")).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a line row with a guest key is a 500", async () => {
    as("owner", {
      trace_line_search: ok({ ...TRACE_LINES, lines: [{ ...TRACE_LINES.lines[0]!, guest: "x" }] }),
    });
    expect((await call(lines, "/lines?date=1998-11-13")).status).toBe(500);
  });
});

describe("GET /api/trace/lines/[id]", () => {
  it("owner and chef replies pass; a chef reply with an invoice is a 500", async () => {
    as("owner", { trace_order_line: ok(TRACE_ORDER_LINE_OWNER) });
    const owner = await call(line, `/lines/${IDS.line}`, IDS.line);
    expect(owner.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("trace_order_line", { p_line: IDS.line });
    as("chef", { trace_order_line: ok(TRACE_ORDER_LINE_CHEF) });
    expect((await call(line, `/lines/${IDS.line}`, IDS.line)).status).toBe(200);
    as("chef", { trace_order_line: ok(TRACE_ORDER_LINE_OWNER) });
    expect((await call(line, `/lines/${IDS.line}`, IDS.line)).status).toBe(500);
  });

  it("a draft line answers with empty lists", async () => {
    as("owner", {
      trace_order_line: ok({
        ...TRACE_ORDER_LINE_OWNER,
        line: { ...TRACE_ORDER_LINE_OWNER.line, firedAt: null, state: "draft" },
        batches: [],
        rawDirect: [],
        lots: [],
      }),
    });
    expect((await call(line, `/lines/${IDS.line}`, IDS.line)).status).toBe(200);
  });

  it("not found 404; malformed 404 with no RPC", async () => {
    as("owner", { trace_order_line: failure("P0002", "not_found") });
    expect((await call(line, `/lines/${IDS.line}`, IDS.line)).status).toBe(404);
    as("owner", { trace_order_line: ok(TRACE_ORDER_LINE_OWNER) });
    expect((await call(line, "/lines/q", "q")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("hygiene", () => {
  it("an unexpected database error is a 500 and the reporter gets a code only", async () => {
    as("owner", {
      trace_lot_search: failure("XX000", `boom on raw_lot for ${IDS.lot} SECRET-LOT`),
    });
    const response = await call(lots, "/lots?q=SECRET-LOT");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/SECRET-LOT|raw_lot/);
    const reported = vi.mocked(reportError).mock.calls.map((c) => String((c[0] as Error).message));
    expect(reported.length).toBeGreaterThan(0);
    for (const message of reported) {
      expect(message).not.toMatch(/SECRET-LOT|raw_lot|7a000000/);
      expect(message).toContain("XX000");
    }
  });

  it("a rejected reply reports a code only, never the reply", async () => {
    as("chef", {
      trace_lot: ok({ ...TRACE_LOT_CHEF, lot: { ...TRACE_LOT_CHEF.lot, invoice: { id: "x" } } }),
    });
    await call(lot, `/lots/${IDS.lot}`, IDS.lot);
    const reported = vi.mocked(reportError).mock.calls.map((c) => String((c[0] as Error).message));
    expect(reported.length).toBe(1);
    expect(reported[0]).not.toMatch(/L-DEMO|Farina|7a000000|invoice/);
  });

  it("OFFLINE_CACHE_PATHS is unchanged: the trace is never offline-cached", () => {
    expect([...OFFLINE_CACHE_PATHS]).toEqual([
      "/api/me",
      "/api/menu",
      "/api/tables",
      "/api/table-sessions/:id/lines",
    ]);
  });
});
