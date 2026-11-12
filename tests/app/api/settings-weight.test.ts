import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/settings/weight/route");
const URL_ = "http://localhost:3000/api/settings/weight";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const READ = {
  weightMaxG: 3000,
  defaultWeightMaxG: 3000,
  minWeightG: 50,
  stepG: 10,
  settingMinG: 500,
  settingMaxG: 10000,
};
const SET = { changed: true, weightMaxG: 4000 };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { weight_settings: [ok(READ)], set_weight_settings: [ok(SET)], ...rpc },
  });
}
const put = (body: unknown, init: RequestInit = {}) =>
  route.PUT(jsonRequest(URL_, body, { method: "PUT", ...init }));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/settings/weight", () => {
  it.each(["owner", "admin"])("%s gets the weight settings with one RPC", async (role) => {
    as(role);
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(READ);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("weight_settings");
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an injected cost key in the reply is a 500, never sent", async () => {
    as("owner", { weight_settings: [ok({ ...READ, unit_cost: 1 })] });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("unit_cost");
  });
});

describe("PUT /api/settings/weight", () => {
  it.each(["owner", "admin"])("%s: one RPC with the body, 200 with the reply", async (role) => {
    as(role);
    const response = await put({ weightMaxG: 4000 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SET);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("set_weight_settings", {
      p_body: { weightMaxG: 4000 },
    });
  });

  it("null goes back to the default", async () => {
    as("owner", { set_weight_settings: [ok({ changed: true, weightMaxG: 3000 })] });
    const response = await put({ weightMaxG: null });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("set_weight_settings", {
      p_body: { weightMaxG: null },
    });
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await put({ weightMaxG: 4000 })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await put({ weightMaxG: 4000 })).status).toBe(401);
  });

  it.each([
    ["a string", { weightMaxG: "4000" }],
    ["a fraction", { weightMaxG: 4000.5 }],
    ["a missing key", {}],
    ["an extra key", { weightMaxG: 4000, defaultWeightMaxG: 1 }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await put(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("490 and 10010 reach the database, which answers 422 weight_max_invalid", async () => {
    as("owner", { set_weight_settings: [failure("P0001", "weight_max_invalid")] });
    const response = await put({ weightMaxG: 490 });
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error.code).toBe("weight_max_invalid");
    expect(json.error.message).toMatch(/peso massimo/i);
  });

  it("text/plain is 415 and a body over 4 KiB is 413", async () => {
    expect((await put("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await put(
      { weightMaxG: 4000 },
      { headers: { "content-type": "application/json", "content-length": "4097" } },
    );
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
