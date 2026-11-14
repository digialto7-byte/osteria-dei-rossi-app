import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
  type StorageResult,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/invoices/[id]/original/route");

const ID = "1b000000-0000-4000-8000-0000000000b1";
const URL_ = `http://localhost:3000/api/invoices/${ID}/original`;
const TENANT = "11111111-1111-4111-8111-111111111111";
const XML_PATH = `${TENANT}/2026/${ID}.xml`;
const P7M_PATH = `${TENANT}/2026/${ID}.p7m`;
const BYTES = new TextEncoder().encode("<a>originale</a>");
const ok = (data: unknown): FakeResult => ({ data, error: null });
const row = (path: string, mime: string, name: string | null) =>
  ok({ file_path: path, file_mime: mime, original_filename: name });
const blob = (): StorageResult => ({ data: new Blob([BYTES]), error: null });

function as(role: string, invoice: FakeResult[], download: StorageResult[] = [blob()]) {
  client = fakeSupabase({ claims: claimsFor(role), results: { invoice }, storage: { download } });
}
const call = () => route.GET(new Request(URL_), routeContext({ id: ID }));

beforeEach(() => {
  reportError.mockReset();
  as("owner", [row(XML_PATH, "application/xml", "IT01234567890_00001.xml")]);
});

describe("GET /api/invoices/:id/original", () => {
  it("reads the stored bytes from Storage with the signed-in user's client", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    expect(client.storage.from).toHaveBeenCalledWith("invoices");
    expect(client.storage.download).toHaveBeenCalledWith(XML_PATH);
    expect(client.storage.createSignedUrl).not.toHaveBeenCalled();
    expect(client.query.select).toHaveBeenCalledWith("file_path, file_mime, original_filename");
    expect(client.query.eq).toHaveBeenCalledWith("id", ID);
  });

  it("Content-Disposition is an attachment with the safe generated name", async () => {
    expect((await call()).headers.get("content-disposition")).toBe(
      'attachment; filename="IT01234567890_00001.xml"',
    );
  });

  it("keeps .xml.p7m for a signed file", async () => {
    as("owner", [row(P7M_PATH, "application/pkcs7-mime", "IT01234567890_00001.xml.p7m")]);
    expect((await call()).headers.get("content-disposition")).toBe(
      'attachment; filename="IT01234567890_00001.xml.p7m"',
    );
  });

  it("never puts a hostile stored name into the header", async () => {
    as("owner", [row(XML_PATH, "application/xml", '../x/b"x;\r\nSet-Cookie: a=b.xml')]);
    const header = (await call()).headers.get("content-disposition")!;
    expect(header).toBe('attachment; filename="b_x_Set-Cookie_ a_b.xml"');
  });

  it("falls back to fattura.xml when there is no stored name", async () => {
    as("owner", [row(XML_PATH, "application/xml", null)]);
    expect((await call()).headers.get("content-disposition")).toBe(
      'attachment; filename="fattura.xml"',
    );
  });

  it("X-Content-Type-Options is nosniff", async () => {
    expect((await call()).headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("Content-Type is application/octet-stream, never the XML type", async () => {
    expect((await call()).headers.get("content-type")).toBe("application/octet-stream");
  });

  it("Content-Security-Policy is sandbox with default-src 'none'", async () => {
    expect((await call()).headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'",
    );
  });

  // Set by withApi (its default), not by the route: the route has no header of its own to keep in step.
  it("Cache-Control is no-store, on the download and on a refusal", async () => {
    expect((await call()).headers.get("cache-control")).toBe("no-store");
    as("owner", [ok(null)]);
    const missing = await call();
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  it("works for an admin", async () => {
    as("admin", [row(XML_PATH, "application/xml", null)]);
    expect((await call()).status).toBe(200);
  });

  it.each(["chef", "waiter"])(
    "answers 403 for a %s before any query or Storage call",
    async (role) => {
      as(role, [row(XML_PATH, "application/xml", null)]);
      expect((await call()).status).toBe(403);
      expect(client.from).not.toHaveBeenCalled();
      expect(client.storage.download).not.toHaveBeenCalled();
    },
  );

  it("answers 401 without a session", async () => {
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
  });

  it("answers 404 for another tenant's or an unknown invoice, without asking Storage", async () => {
    as("owner", [ok(null)]);
    const response = await call();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
    expect(client.storage.download).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed id", async () => {
    const response = await route.GET(new Request(URL_), routeContext({ id: "x" }));
    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers the same 404 for a PDF: only e-invoice files are served here", async () => {
    as("owner", [row(`${TENANT}/2026/${ID}.pdf`, "application/pdf", "a.pdf")]);
    const response = await call();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
    expect(client.storage.download).not.toHaveBeenCalled();
  });

  it("a Storage failure is reported by status only and answered 502, never an empty file", async () => {
    as(
      "owner",
      [row(XML_PATH, "application/xml", "Fornitore Rossi.xml")],
      [{ data: null, error: { message: `SECRET ${XML_PATH}`, statusCode: "500" } }],
    );
    const response = await call();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("upstream_error");
    expect(reportError).toHaveBeenCalledOnce();
    const message = String((reportError.mock.calls[0]![0] as Error).message);
    expect(message).toBe(
      `E-invoice original could not be read from storage (status 500) for invoice ${ID}`,
    );
    expect(message).not.toMatch(/SECRET|Rossi|\.xml/);
  });

  it("Storage answering neither data nor an error is the same 502", async () => {
    as("owner", [row(XML_PATH, "application/xml", null)], [{ data: null, error: null }]);
    expect((await call()).status).toBe(502);
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("exports GET only", () => {
    for (const method of ["POST", "DELETE", "PUT", "PATCH"]) {
      expect(route).not.toHaveProperty(method);
    }
  });
});
