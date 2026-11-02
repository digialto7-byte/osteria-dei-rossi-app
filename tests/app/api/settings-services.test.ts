import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { SERVICE_PERIODS, SET_SERVICE_PERIODS } from "../../helpers/services-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/settings/services/route");
const URL_ = "http://localhost:3000/api/settings/services";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details: details ?? null },
});

const BODY = {
  periods: [
    { key: null, name: "Aperitivo", startsAt: "18:00" },
    { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
    { key: "cena", name: "Cena", startsAt: "19:30" },
  ],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: {
      service_periods: [ok(SERVICE_PERIODS)],
      set_service_periods: [ok(SET_SERVICE_PERIODS)],
      ...rpc,
    },
  });
}
const get = (query = "") => route.GET(new Request(`${URL_}${query}`));
const patch = (body: unknown, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }));
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string; details?: unknown } })
    .error;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/settings/services", () => {
  it.each(["owner", "admin"])("%s gets the periods in one RPC", async (role) => {
    as(role);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SERVICE_PERIODS);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("service_periods");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("carries Server-Timing", async () => {
    expect((await get()).headers.get("server-timing")).toMatch(
      /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/,
    );
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("any query is 400 without an RPC", async () => {
    expect((await get("?x=1")).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a reply with an extra key is a 500 that leaks nothing", async () => {
    as("owner", { service_periods: [ok({ ...SERVICE_PERIODS, createdBy: "Titolare Demo" })] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Titolare");
  });
});

describe("PATCH /api/settings/services", () => {
  it.each(["owner", "admin"])("%s: one RPC with exactly { p_body }", async (role) => {
    as(role);
    const response = await patch(BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SET_SERVICE_PERIODS);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("set_service_periods", { p_body: BODY });
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patch(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await patch(BODY)).status).toBe(401);
  });

  it("text/plain is 415 and a 3 KB body is 413", async () => {
    expect((await patch("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await patch(BODY, {
      headers: { "content-type": "application/json", "content-length": "3072" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["seven periods", { periods: Array(7).fill({ key: "pranzo", name: "P", startsAt: "11:00" }) }],
    ["no period", { periods: [] }],
    ["a start of 9:00", { periods: [{ key: null, name: "P", startsAt: "9:00" }] }],
    [
      "an extra key in a period",
      { periods: [{ key: null, name: "P", startsAt: "9:00", endsAt: "10:00" }] },
    ],
    ["an extra top-level key", { ...BODY, x: 1 }],
    ["a missing key field", { periods: [{ name: "P", startsAt: "11:00" }] }],
  ])("%s is 400 without an RPC", async (_label, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0001 service_periods_invalid (start_twice) is 422 with the Italian sentence and the reason", async () => {
    as("owner", {
      set_service_periods: [
        failure("P0001", "service_periods_invalid", '{"reason": "start_twice"}'),
      ],
    });
    const response = await patch(BODY);
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe("service_periods_invalid");
    expect(error.message).toBe("Due servizi non possono iniziare alla stessa ora.");
    expect(error.details).toEqual({ reason: "start_twice" });
  });

  it("an unexpected database error is a 500 that names no message", async () => {
    as("owner", { set_service_periods: [failure("XX000", "secret internals")] });
    const response = await patch(BODY);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("a reply with an extra key is a 500 (T2: PATCH with a body schema works as for the coperto)", async () => {
    as("owner", { set_service_periods: [ok({ ...SET_SERVICE_PERIODS, createdBy: "x" })] });
    expect((await patch(BODY)).status).toBe(500);
  });
});
