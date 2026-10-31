import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/dashboard/opens/route");
const URL_ = "http://localhost:3000/api/dashboard/opens";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply: FakeResult = ok({ isoWeek: "2026-11-02", opens: 1 })) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { record_dashboard_open: [reply] },
  });
}
const post = (body: string | null = "{}", headers: Record<string, string> = {}) =>
  (route.POST as (r: Request) => Promise<Response>)(
    new Request(URL_, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        ...(body === null
          ? {}
          : { "content-length": String(new TextEncoder().encode(body).length) }),
        ...headers,
      },
      body,
    }),
  );

beforeEach(() => as("owner"));

describe("POST /api/dashboard/opens", () => {
  it("the owner: one record_dashboard_open RPC, and the week and the count come back", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ isoWeek: "2026-11-02", opens: 1 });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("record_dashboard_open");
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(["admin", "chef", "waiter"])("%s: 403 before any RPC", async (role) => {
    as(role);
    expect((await post()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session: 401", async () => {
    as("none");
    expect((await post()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a body that is not JSON is a 415", async () => {
    const response = await post("{}", { "content-type": "text/plain" });
    expect(response.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a body of more than 64 bytes is a 413", async () => {
    const response = await post(JSON.stringify({ pad: "x".repeat(80) }));
    expect(response.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a body with a key is a 400", async () => {
    const response = await post('{"userId":"x"}');
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("42501 from the database is a 403", async () => {
    as("owner", failure("42501", "permission denied"));
    expect((await post()).status).toBe(403);
  });

  it("a malformed reply is a 500 and not passed on", async () => {
    as("owner", ok({ isoWeek: "2026-11-02", opens: 1, userId: "x" }));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("userId");
  });

  it("is never cached", async () => {
    expect((await post()).headers.get("cache-control")).toBe("no-store");
  });
});
