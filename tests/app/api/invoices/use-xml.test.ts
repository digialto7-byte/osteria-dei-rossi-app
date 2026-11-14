import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeContext, type FakeResult, type FakeSupabase } from "../../../helpers/fake-supabase";
import { INVOICE_ID, PARTNER_ID, dbError, ok, reviewClient } from "../../../helpers/review-data";

let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/invoices/[id]/use-xml/route");

const BASE = `http://localhost:3000/api/invoices/${INVOICE_ID}/use-xml`;
const post = (body: unknown = { replaces: PARTNER_ID }, id = INVOICE_ID, init: RequestInit = {}) =>
  route.POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
    routeContext({ id }),
  );

function as(role: string, replace: FakeResult = ok({ status: "review" })) {
  client = reviewClient(role, { rpc: { review_replace_with_xml: [replace] } });
}
const calls = () => client.rpc.mock.calls;

beforeEach(() => {
  reportError.mockReset();
  as("owner");
});

describe("POST /api/invoices/:id/use-xml", () => {
  it("replaces the other copy with this XML invoice and answers its new status", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(calls()).toEqual([
      ["review_replace_with_xml", { p_xml: INVOICE_ID, p_other: PARTNER_ID }],
    ]);
    expect(await response.json()).toEqual({ status: "review" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers duplicate when another look-alike is still live", async () => {
    as("owner", ok({ status: "duplicate" }));
    expect(await (await post()).json()).toEqual({ status: "duplicate" });
  });

  it("works for an admin", async () => {
    as("admin");
    expect((await post()).status).toBe(200);
  });

  it.each([
    ["an extra key", { replaces: PARTNER_ID, other: 1 }],
    ["no key", {}],
    ["a replaces that is not a uuid", { replaces: "x" }],
    ["a number", { replaces: 5 }],
    ["an array", []],
  ])("answers 400 for %s and calls no procedure", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(calls()).toHaveLength(0);
  });

  it("answers 404 for an id that is not a uuid, before any call", async () => {
    expect((await post(undefined, "x")).status).toBe(404);
    expect(calls()).toHaveLength(0);
  });

  it("answers 409 replace_not_allowed, in Italian, when the situation changed", async () => {
    as("owner", dbError("P0001", "replace_not_allowed"));
    const response = await post();
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error.code).toBe("replace_not_allowed");
    expect(error.message).not.toMatch(/P0001|replace_not_allowed/);
  });

  it("answers 404 for another tenant's invoice and 403 from the database gate", async () => {
    as("owner", dbError("P0002", "not_found"));
    expect((await post()).status).toBe(404);
    as("owner", dbError("42501", "x"));
    expect((await post()).status).toBe(403);
  });

  it.each(["chef", "waiter"])("answers 403 for a %s with no procedure called", async (role) => {
    as(role);
    expect((await post()).status).toBe(403);
    expect(calls()).toHaveLength(0);
  });

  it("answers 401 without a session", async () => {
    client = reviewClient("none");
    expect((await post()).status).toBe(401);
  });

  it("is a 500 reported by SQLSTATE when the database replies with something unexpected", async () => {
    as("owner", ok({ status: "approved" }));
    expect((await post()).status).toBe(500);
    expect(reportError).toHaveBeenCalledOnce();
    as("owner", dbError("XX000", "SECRET text"));
    expect((await post()).status).toBe(500);
    expect(String((reportError.mock.calls[1]![0] as Error).message)).not.toContain("SECRET");
  });

  it("exports POST only", () => {
    for (const method of ["GET", "DELETE", "PUT", "PATCH"])
      expect(route).not.toHaveProperty(method);
  });
});
