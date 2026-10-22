import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
  type StorageResult,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/invoices/[id]/file-url/route");
const { SIGNED_URL_TTL_SECONDS } = await import("@/server/invoices/constants");

const ID = "1b000000-0000-4000-8000-0000000000b1";
const URL_ = `http://localhost:3000/api/invoices/${ID}/file-url`;
const PATH = "11111111-1111-4111-8111-111111111111/2026/1b000000-0000-4000-8000-0000000000b1.pdf";
const SIGNED = "https://storage.example.test/object/sign/invoices/x?token=fake-token";
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, invoice: FakeResult[], createSignedUrl?: StorageResult[]) {
  client = fakeSupabase({
    claims: claimsFor(role),
    results: { invoice },
    storage: { createSignedUrl },
  });
}
const call = () => route.GET(new Request(URL_), routeContext({ id: ID }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
  as("owner", [ok({ file_path: PATH })], [{ data: { signedUrl: SIGNED }, error: null }]);
});
afterEach(() => vi.useRealTimers());

describe("GET /api/invoices/:id/file-url (M2 acceptance tests 4-5)", () => {
  it("returns a signed URL valid for 300 seconds, with its expiry", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(client.from).toHaveBeenCalledWith("invoice");
    expect(client.query.select).toHaveBeenCalledWith("file_path");
    expect(client.query.eq).toHaveBeenCalledWith("id", ID);
    expect(client.storage.from).toHaveBeenCalledWith("invoices");
    expect(client.storage.createSignedUrl).toHaveBeenCalledWith(PATH, 300);
    expect(await response.json()).toEqual({ url: SIGNED, expiresAt: "2026-10-22T10:05:00.000Z" });
  });

  it("is never cached and does not repeat the storage path", async () => {
    const response = await call();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain(PATH);
  });

  it("works for an admin", async () => {
    as("admin", [ok({ file_path: PATH })]);
    expect((await call()).status).toBe(200);
  });

  it("answers 404 and does not call Storage when the row is not visible (other tenant)", async () => {
    as("owner", [ok(null)]);
    const response = await call();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
    expect(client.storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed id without any query or Storage call", async () => {
    const response = await route.GET(new Request(URL_), routeContext({ id: "x" }));
    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any query", async (role) => {
    as(role, [ok({ file_path: PATH })]);
    expect((await call()).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
  });

  it("answers 502 when Storage cannot sign the URL", async () => {
    as("owner", [ok({ file_path: PATH })], [{ data: null, error: { message: "object missing" } }]);
    const response = await call();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("upstream_error");
  });

  it("answers 502 when Storage returns no URL at all", async () => {
    as("owner", [ok({ file_path: PATH })], [{ data: {}, error: null }]);
    expect((await call()).status).toBe(502);
  });

  it("answers 500 on an unexpected database error", async () => {
    as("owner", [{ data: null, error: { code: "XX000", message: "boom" } }]);
    expect((await call()).status).toBe(500);
    expect(client.storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("exports GET only", () => {
    for (const method of ["POST", "DELETE", "PUT", "PATCH"]) {
      expect(route).not.toHaveProperty(method);
    }
  });
});
