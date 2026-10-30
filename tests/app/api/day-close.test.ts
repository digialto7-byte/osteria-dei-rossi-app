import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { ENTER_REPLY, REPORT } from "../../helpers/bill-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/day-close/route");
const URL_ = "http://localhost:3000/api/day-close";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const BODY = { registerTotal: "1222.00", businessDate: "2026-11-04" };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { enter_day_close: [ok(ENTER_REPLY)], ...rpc },
  });
}
const post = (body: unknown, init: RequestInit = {}) => route.POST(jsonRequest(URL_, body, init));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("POST /api/day-close", () => {
  it.each(["owner", "admin"])("%s: one RPC, the report is in the reply", async (role) => {
    as(role);
    const response = await post(BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ENTER_REPLY);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("enter_day_close", { p_body: BODY });
  });

  it("sends the date as given or leaves it out (the database takes today's)", async () => {
    await post({ registerTotal: "10" });
    expect(client.rpc).toHaveBeenCalledWith("enter_day_close", { p_body: { registerTotal: "10" } });
  });

  it.each(["waiter", "chef"])(
    "AT5: a %s gets 403 before any RPC (the spy is called 0 times)",
    async (role) => {
      as(role);
      const response = await post(BODY);
      expect(response.status).toBe(403);
      expect(client.rpc).toHaveBeenCalledTimes(0);
      expect(client.from).not.toHaveBeenCalled();
    },
  );

  it("carries Server-Timing and is never cached", async () => {
    const response = await post(BODY);
    expect(response.headers.get("server-timing")).toMatch(TIMING);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("no session is 401, text/plain 415, a body over 1 KiB 413, all without an RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post(BODY)).status).toBe(401);
    as("owner");
    expect((await post("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await post(BODY, {
          headers: { "content-type": "application/json", "content-length": "1025" },
        })
      ).status,
    ).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a JSON number", { registerTotal: 1222 }],
    ["a comma amount", { registerTotal: "1.222,00" }],
    ["a negative amount", { registerTotal: "-1" }],
    ["eight digits", { registerTotal: "12345678" }],
    ["a stray key", { registerTotal: "1", x: 1 }],
    ["a bad date", { registerTotal: "1", businessDate: "2026-13-01" }],
    ["no body keys", {}],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["register_total_invalid", "business_date_invalid"])(
    "P0001 %s is a 422 with the same code",
    async (code) => {
      as("owner", { enter_day_close: [failure("P0001", code)] });
      const response = await post(BODY);
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe(code);
    },
  );

  it("a database 42501 is a 403 with the owner-only text", async () => {
    as("owner", { enter_day_close: [failure("42501", "permission denied")] });
    const response = await post(BODY);
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe(
      "La chiusura di cassa è riservata al titolare.",
    );
  });

  it("a key injected into the report is a 500 and never reaches the JSON", async () => {
    as("owner", { enter_day_close: [ok({ changed: true, report: { ...REPORT, margin: 0.3 } })] });
    const response = await post(BODY);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("margin");
  });
});
