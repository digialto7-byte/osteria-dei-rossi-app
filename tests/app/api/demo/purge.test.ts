import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { en } from "@/lib/i18n/messages/en";
import { it as itMessages } from "@/lib/i18n/messages/it";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/demo/purge/route");
const URL_ = "http://localhost:3000/api/demo/purge";
const NAME = "Osteria Demo (dati di prova)";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, result: FakeResult = ok({ tenantId: "x", rowCounts: {} })) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { purge_demo_tenant: [result] } });
}
const post = (body: unknown, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, { method: "POST", ...init }));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("POST /api/demo/purge", () => {
  it("owner: one RPC with the typed name, answer {purged: true} and nothing else", async () => {
    const response = await post({ confirmName: NAME });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ purged: true });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("purge_demo_tenant", { p_confirm_name: NAME });
  });

  it("sends the name exactly as typed (no trimming: the server compares it)", async () => {
    await post({ confirmName: ` ${NAME}` });
    expect(client.rpc).toHaveBeenCalledWith("purge_demo_tenant", { p_confirm_name: ` ${NAME}` });
  });

  it.each(["admin", "chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    const response = await post({ confirmName: NAME });
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, with no RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post({ confirmName: NAME })).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { confirmName: NAME, tenantId: "x" }],
    ["no name", {}],
    ["a number", { confirmName: 5 }],
    ["an empty name", { confirmName: "" }],
    ["a name over 200 characters", { confirmName: "x".repeat(201) }],
  ])("%s is 400 and nothing is called", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415", async () => {
    const response = await route.POST(
      new Request(URL_, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ confirmName: NAME }),
      }),
    );
    expect(response.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a body declared over 1 KiB is 413", async () => {
    const response = await route.POST(
      new Request(URL_, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "1025" },
        body: JSON.stringify({ confirmName: NAME }),
      }),
    );
    expect(response.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("not_demo_tenant (42501 with that message) is 403 with its own text, not the role text", async () => {
    as("owner", failure("42501", "not_demo_tenant"));
    const response = await post({ confirmName: NAME });
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error.code).toBe("not_demo_tenant");
    expect(json.error.message).toBe("Questo locale non contiene dati di prova.");
  });

  it("a role refusal from SQL (42501, another message) is 403 forbidden", async () => {
    as("owner", failure("42501", "permission denied: the demo purge needs the owner"));
    const response = await post({ confirmName: NAME });
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error.code).toBe("forbidden");
    expect(JSON.stringify(json)).not.toContain("demo purge needs");
  });

  it("confirm_name_mismatch is 422 with the Italian text", async () => {
    as("owner", failure("P0001", "confirm_name_mismatch"));
    const response = await post({ confirmName: "osteria" });
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error.code).toBe("confirm_name_mismatch");
    expect(json.error.message).toBe("Il nome non corrisponde.");
  });

  it("any other database error is 500 without the database text", async () => {
    as("owner", failure("XX000", "secret internal detail"));
    const response = await post({ confirmName: NAME });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret internal detail");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("an unknown P0001 message is 500, not echoed", async () => {
    as("owner", failure("P0001", "something_else"));
    const response = await post({ confirmName: NAME });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("something_else");
  });
});

describe("demo messages", () => {
  it("exist in Italian and in English", () => {
    for (const key of ["demoError.not_demo_tenant", "demoError.confirm_name_mismatch"] as const) {
      expect(itMessages[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
    expect(itMessages["demoError.not_demo_tenant"]).toBe(
      "Questo locale non contiene dati di prova.",
    );
    expect(itMessages["demoError.confirm_name_mismatch"]).toBe("Il nome non corrisponde.");
  });
});
