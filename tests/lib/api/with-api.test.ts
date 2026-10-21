import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  routeContext,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

let client: FakeSupabase;
const reportError = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const { withApi } = await import("@/lib/api/with-api");
const { ApiError } = await import("@/lib/api/errors");

const URL_ = "http://localhost:3000/api/test";
const echo = withApi(
  { roles: ["owner", "admin"], body: z.object({ name: z.string().min(1) }) },
  async ({ body, session }) => Response.json({ name: body.name, role: session.role }),
);

beforeEach(() => {
  client = fakeSupabase({ claims: OWNER_CLAIMS });
  reportError.mockReset();
});

describe("withApi", () => {
  it("passes the parsed body and session to the handler", async () => {
    const response = await echo(jsonRequest(URL_, { name: "Osteria Demo" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Osteria Demo", role: "owner" });
  });

  it("rejects an unknown body field with 400 invalid_request", async () => {
    const response = await echo(jsonRequest(URL_, { name: "x", isAdmin: true }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toContain("isAdmin");
  });

  it("rejects a body that fails validation with 400 invalid_request", async () => {
    const response = await echo(jsonRequest(URL_, { name: "" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("rejects malformed JSON with 400 invalid_json", async () => {
    const response = await echo(jsonRequest(URL_, "{not json"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_json");
  });

  it("rejects a state-changing request that is not JSON with 415", async () => {
    const response = await echo(
      new Request(URL_, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }),
    );
    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe("unsupported_media_type");
  });

  it("returns 401 when there is no session", async () => {
    client = fakeSupabase({ claims: null });
    const response = await echo(jsonRequest(URL_, { name: "x" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthenticated", message: expect.any(String) },
    });
  });

  it("returns 403 no_tenant when the token has no tenant claim", async () => {
    client = fakeSupabase({ claims: { sub: OWNER_CLAIMS.sub } });
    const response = await echo(jsonRequest(URL_, { name: "x" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("no_tenant");
  });

  it("returns 403 forbidden when the role is not allowed", async () => {
    client = fakeSupabase({ claims: { ...OWNER_CLAIMS, app_role: "waiter" } });
    const response = await echo(jsonRequest(URL_, { name: "x" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
  });

  it("treats an unknown role claim as forbidden", async () => {
    client = fakeSupabase({ claims: { ...OWNER_CLAIMS, app_role: "superuser" } });
    const response = await echo(jsonRequest(URL_, { name: "x" }));
    expect(response.status).toBe(403);
  });

  it("maps an ApiError thrown by the handler to its status and code", async () => {
    const route = withApi({ roles: ["owner"] }, async () => {
      throw new ApiError(404, "not_found", "Risorsa non trovata");
    });
    const response = await route(new Request(URL_));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Risorsa non trovata" },
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("hides unexpected errors behind a 500 without a stack trace, and reports them", async () => {
    const route = withApi({ roles: ["owner"] }, async () => {
      throw new Error("db password is hunter2 at /srv/app/x.ts:12");
    });
    const response = await route(new Request(URL_));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: expect.any(String) } });
    expect(text).not.toContain("hunter2");
    expect(text).not.toMatch(/at \/|\.ts:\d+/);
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("public routes skip the session lookup", async () => {
    client = fakeSupabase({ claims: null });
    const route = withApi({ public: true }, async ({ session }) => Response.json({ session }));
    const response = await route(new Request(URL_));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session: null });
    expect(client.auth.getClaims).not.toHaveBeenCalled();
  });

  describe("route params", () => {
    const ID = "9b2f1c3e-4d5a-4b6c-8d7e-0f1a2b3c4d5e";
    const handler = vi.fn(async ({ params }: { params: { id: string } }) =>
      Response.json({ id: params.id }),
    );
    const route = withApi({ roles: ["owner"], params: z.object({ id: z.uuid() }) }, handler);

    beforeEach(() => {
      handler.mockClear();
    });

    it("passes validated params to the handler", async () => {
      const response = await route(new Request(URL_), routeContext({ id: ID }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: ID });
    });

    it("answers 404 for an id that is not a uuid, without calling the handler", async () => {
      const response = await route(new Request(URL_), routeContext({ id: "x" }));
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("not_found");
      expect(handler).not.toHaveBeenCalled();
    });

    it("answers 404 when the route has no params at all", async () => {
      expect((await route(new Request(URL_))).status).toBe(404);
    });
  });

  it("serialises ApiError details under error.details", async () => {
    const route = withApi({ roles: ["owner"] }, async () => {
      throw new ApiError(422, "import_invalid", "Righe non valide", [
        { row: 3, field: "partita_iva", code: "invalid_vat_number" },
      ]);
    });
    const response = await route(new Request(URL_));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "import_invalid",
        message: "Righe non valide",
        details: [{ row: 3, field: "partita_iva", code: "invalid_vat_number" }],
      },
    });
  });

  it("sets Cache-Control: no-store on API responses", async () => {
    const response = await echo(jsonRequest(URL_, { name: "x" }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
