import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { SERVICE_SESSION_ID, SESSION_SERVICE } from "../../helpers/services-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/table-sessions/[id]/service/route");
const URL_ = `http://localhost:3000/api/table-sessions/${SERVICE_SESSION_ID}/service`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { set_session_service: [ok(SESSION_SERVICE)], ...rpc },
  });
}
const move = (body: unknown, id: string = SERVICE_SESSION_ID, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string } }).error;

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("POST /api/table-sessions/:id/service", () => {
  it.each(["owner", "admin"])("%s: one RPC with the session and the body", async (role) => {
    as(role);
    const response = await move({ serviceKey: "pranzo" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SESSION_SERVICE);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("set_session_service", {
      p_session: SERVICE_SESSION_ID,
      p_body: { serviceKey: "pranzo" },
    });
  });

  it("null puts the table back to automatic", async () => {
    await move({ serviceKey: null });
    expect(client.rpc).toHaveBeenCalledWith("set_session_service", {
      p_session: SERVICE_SESSION_ID,
      p_body: { serviceKey: null },
    });
  });

  it("carries Server-Timing and is never cached", async () => {
    const response = await move({ serviceKey: "pranzo" });
    expect(response.headers.get("server-timing")).toMatch(TIMING);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await move({ serviceKey: "pranzo" })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await move({ serviceKey: "pranzo" })).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a malformed id is 404 without an RPC", async () => {
    const response = await move({ serviceKey: "pranzo" }, "not-a-uuid");
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a big body is 413", async () => {
    expect(
      (await move("x", SERVICE_SESSION_ID, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await move({ serviceKey: "pranzo" }, SERVICE_SESSION_ID, {
      headers: { "content-type": "application/json", "content-length": "5000" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an upper-case key", { serviceKey: "Cena" }],
    ["an empty body", {}],
    ["a number", { serviceKey: 1 }],
    ["an extra key", { serviceKey: "cena", x: 1 }],
    ["a key that is too short", { serviceKey: "c" }],
  ])("%s is 400 without an RPC", async (_label, body) => {
    expect((await move(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("service_day_final is 409 with the Italian sentence", async () => {
    as("owner", { set_session_service: [failure("P0001", "service_day_final")] });
    const response = await move({ serviceKey: "pranzo" });
    expect(response.status).toBe(409);
    const error = await errorOf(response);
    expect(error.code).toBe("service_day_final");
    expect(error.message).toBe("La giornata è già chiusa: il servizio non si può più cambiare.");
  });

  it("service_unknown is 422", async () => {
    as("owner", { set_session_service: [failure("P0001", "service_unknown")] });
    const response = await move({ serviceKey: "aperitivo" });
    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe("service_unknown");
  });

  it("P0002 session_not_found is 404 session_not_found (also another tenant's id)", async () => {
    as("owner", { set_session_service: [failure("P0002", "session_not_found")] });
    const response = await move({ serviceKey: "pranzo" });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("session_not_found");
  });

  it("42501 from the database is 403", async () => {
    as("owner", { set_session_service: [failure("42501", "permission denied")] });
    expect((await move({ serviceKey: "pranzo" })).status).toBe(403);
  });

  it("an unexpected database error is a 500 that names no message", async () => {
    as("owner", { set_session_service: [failure("XX000", "secret internals")] });
    const response = await move({ serviceKey: "pranzo" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("a reply with an extra key (a staff name) is a 500", async () => {
    as("owner", {
      set_session_service: [
        ok({
          ...SESSION_SERVICE,
          session: { ...SESSION_SERVICE.session, createdBy: "Titolare Demo" },
        }),
      ],
    });
    const response = await move({ serviceKey: "pranzo" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Titolare");
  });
});
