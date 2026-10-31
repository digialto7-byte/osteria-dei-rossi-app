import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { KITCHEN_TICKETS } from "../../helpers/kitchen-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/kitchen/tickets/route");
const URL_ = "http://localhost:3000/api/kitchen/tickets";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { kitchen_tickets: [ok(KITCHEN_TICKETS)], ...rpc },
  });
}
const get = () => route.GET(new Request(URL_), routeContext({}));

beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

describe("GET /api/kitchen/tickets", () => {
  it.each(["chef", "owner", "admin"])("%s: one RPC, the tickets, never cached", async (role) => {
    as(role);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(KITCHEN_TICKETS);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("kitchen_tickets");
  });

  it("the waiter gets 403 before any RPC", async () => {
    as("waiter");
    const response = await get();
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an empty list is a 200", async () => {
    as("chef", {
      kitchen_tickets: [
        ok({
          asOf: KITCHEN_TICKETS.asOf,
          truncated: false,
          remaining: 0,
          tickets: [],
          closedTickets: [],
        }),
      ],
    });
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect([body.tickets, body.closedTickets, body.remaining]).toEqual([[], [], 0]);
  });

  it("an injected unitPrice or unit_cost key in the reply is a 500 and never in the JSON", async () => {
    const line = { ...KITCHEN_TICKETS.tickets[0]!.lines[0]!, unitPrice: 14, unit_cost: 2.98 };
    as("chef", {
      kitchen_tickets: [
        ok({ ...KITCHEN_TICKETS, tickets: [{ ...KITCHEN_TICKETS.tickets[0]!, lines: [line] }] }),
      ],
    });
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toMatch(/unitPrice|unit_cost|2\.98|14/);
    expect(reportError).toHaveBeenCalled();
  });

  it("42501 from the database is a 403 with the Italian text; anything else a 500 without its text", async () => {
    as("chef", { kitchen_tickets: [failure("42501", "permission denied")] });
    const denied = await get();
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.message).toBe(
      "La lista della cucina non è disponibile per il tuo ruolo.",
    );
    as("chef", { kitchen_tickets: [failure("XX000", "boom")] });
    const broken = await get();
    expect(broken.status).toBe(500);
    expect(await broken.text()).not.toContain("boom");
  });
});
