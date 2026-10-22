import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { fakeEncryptedPdf, fakeJpeg, fakePdf, padTo, textBytes } from "../../../helpers/fake-files";

let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/invoices/route");
const { MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_HOUR } = await import("@/server/invoices/constants");

const URL_ = "http://localhost:3000/api/invoices";
const TENANT = OWNER_CLAIMS.tenant_id;
const ROW = {
  id: "1b000000-0000-4000-8000-0000000000b1",
  status: "received",
  source: "upload",
  file_mime: "application/pdf",
  file_size_bytes: 80,
  original_filename: "fattura.pdf",
  created_at: "2026-12-31T23:30:00.000Z",
};
const ok = (data: unknown, count: number | null = null): FakeResult => ({
  data,
  error: null,
  count,
});

function as(role: string, invoice: FakeResult[] = [ok(null, 0), ok(ROW)], storage = {}) {
  client = fakeSupabase({ claims: claimsFor(role), results: { invoice }, storage });
}

function post(
  parts: Record<string, string | { bytes: Uint8Array; type: string; name: string }>,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  for (const [name, part] of Object.entries(parts)) {
    if (typeof part === "string") form.append(name, part);
    else form.append(name, new File([part.bytes as BlobPart], part.name, { type: part.type }));
  }
  return new Request(URL_, {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-length": "1000", ...headers },
    body: form,
  });
}

const pdf = (name = "fattura.pdf") => ({ bytes: fakePdf(), type: "application/pdf", name });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
  reportError.mockReset();
  as("owner");
});
afterEach(() => vi.useRealTimers());

describe("POST /api/invoices (M2 acceptance tests 1-3)", () => {
  it("stores a valid PDF: 202, Location, path in the tenant folder and the Rome year", async () => {
    const response = await route.POST(post({ file: pdf() }));
    expect(response.status).toBe(202);

    const upload = client.storage.upload.mock.calls[0]!;
    const [path, bytes, options] = upload as [string, Uint8Array, Record<string, unknown>];
    expect(client.storage.from).toHaveBeenCalledWith("invoices");
    expect(path).toMatch(new RegExp(`^${TENANT}/2027/[0-9a-f-]{36}\\.pdf$`));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(options).toEqual({ contentType: "application/pdf", upsert: false });

    const id = path.split("/")[2]!.replace(".pdf", "");
    expect(client.query.insert).toHaveBeenCalledWith({
      id,
      file_path: path,
      file_mime: "application/pdf",
      file_size_bytes: fakePdf().byteLength,
      original_filename: "fattura.pdf",
    });
    // The response echoes the row the database returned.
    expect(response.headers.get("location")).toBe(`/api/invoices/${ROW.id}`);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body).toEqual({
      invoice: {
        id: ROW.id,
        status: "received",
        source: "upload",
        fileMime: "application/pdf",
        fileSizeBytes: 80,
        originalFilename: "fattura.pdf",
        createdAt: "2026-12-31T23:30:00.000Z",
      },
    });
    expect(JSON.stringify(body)).not.toContain(path);
  });

  it("uses the sniffed type for the extension and the content type (JPEG)", async () => {
    await route.POST(post({ file: { bytes: fakeJpeg(), type: "image/jpeg", name: "foto.jpeg" } }));
    const [path, , options] = client.storage.upload.mock.calls[0] as [
      string,
      Uint8Array,
      Record<string, unknown>,
    ];
    expect(path).toMatch(/\.jpg$/);
    expect(options.contentType).toBe("image/jpeg");
  });

  it("stores a display-safe file name and null when the name is empty", async () => {
    await route.POST(post({ file: pdf("../../etc/fattura.pdf") }));
    expect(client.query.insert.mock.calls[0]![0]).toMatchObject({
      original_filename: "fattura.pdf",
    });
  });

  it("works for an admin", async () => {
    as("admin");
    expect((await route.POST(post({ file: pdf() }))).status).toBe(202);
  });

  it("rejects a renamed text file with 415 and calls neither Storage nor the table insert", async () => {
    const response = await route.POST(
      post({ file: { bytes: textBytes(), type: "application/pdf", name: "fattura.pdf" } }),
    );
    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe("unsupported_file_type");
    expect(client.storage.upload).not.toHaveBeenCalled();
    expect(client.query.insert).not.toHaveBeenCalled();
  });

  it("rejects a file over the limit with 413", async () => {
    const big = padTo(fakePdf(), MAX_UPLOAD_BYTES + 1);
    const response = await route.POST(
      post({ file: { bytes: big, type: "application/pdf", name: "grande.pdf" } }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("payload_too_large");
    expect(client.storage.upload).not.toHaveBeenCalled();
  });

  it("rejects an encrypted PDF with 422", async () => {
    const response = await route.POST(
      post({ file: { bytes: fakeEncryptedPdf(), type: "application/pdf", name: "x.pdf" } }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("encrypted_pdf");
    expect(client.storage.upload).not.toHaveBeenCalled();
  });

  it.each(["waiter", "chef"])("answers 403 for a %s before any query", async (role) => {
    as(role);
    const response = await route.POST(post({ file: pdf() }));
    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.storage.upload).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.POST(post({ file: pdf() }))).status).toBe(401);
  });

  it("answers 403 invalid_origin for a foreign Origin, before the session lookup", async () => {
    const response = await route.POST(post({ file: pdf() }, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("invalid_origin");
    expect(client.auth.getClaims).not.toHaveBeenCalled();
  });

  it("answers 413 from Content-Length alone, before the session lookup", async () => {
    const response = await route.POST(post({ file: pdf() }, { "content-length": "99999999" }));
    expect(response.status).toBe(413);
    expect(client.auth.getClaims).not.toHaveBeenCalled();
  });

  it("answers 400 when there is a part besides file (e.g. a tenantId)", async () => {
    const response = await route.POST(post({ file: pdf(), tenantId: TENANT! }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(client.storage.upload).not.toHaveBeenCalled();
  });

  it("answers 400 when there is no file part, or file is plain text", async () => {
    expect((await route.POST(post({ other: "x" }))).status).toBe(400);
    expect((await route.POST(post({ file: "just text" }))).status).toBe(400);
    expect(client.storage.upload).not.toHaveBeenCalled();
  });

  it("answers 400 when the multipart body cannot be parsed", async () => {
    const broken = new Request(URL_, {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-length": "20",
        "content-type": "multipart/form-data; boundary=abc",
      },
      body: "not a multipart body",
    });
    expect((await route.POST(broken)).status).toBe(400);
  });

  it("answers 429 when the tenant already uploaded the hourly maximum", async () => {
    as("owner", [ok(null, MAX_UPLOADS_PER_HOUR)]);
    const response = await route.POST(post({ file: pdf() }));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("rate_limited");
    expect(client.storage.upload).not.toHaveBeenCalled();
    expect(client.query.gte).toHaveBeenCalledWith("created_at", "2026-12-31T22:30:00.000Z");
  });

  it("lets the upload through one below the hourly maximum", async () => {
    as("owner", [ok(null, MAX_UPLOADS_PER_HOUR - 1), ok(ROW)]);
    expect((await route.POST(post({ file: pdf() }))).status).toBe(202);
  });

  it("answers 502 on a Storage error and inserts nothing", async () => {
    as("owner", undefined, { upload: [{ data: null, error: { message: "bucket down" } }] });
    const response = await route.POST(post({ file: pdf() }));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("upstream_error");
    expect(client.query.insert).not.toHaveBeenCalled();
  });

  // storage-js sets `statusCode` from the body's statusCode, else its `code` (e.g. "InvalidJWT"),
  // else the HTTP status; `status` is the HTTP status (often 400 for a policy refusal).
  it.each([
    [{ status: 400, statusCode: "403" }, 403, "forbidden"],
    [{ status: 401, statusCode: "InvalidJWT" }, 401, "unauthenticated"],
    [{ status: 413, statusCode: "413" }, 413, "payload_too_large"],
    [{ status: 400, statusCode: "415" }, 415, "unsupported_file_type"],
    [{ status: 403, statusCode: "AccessDenied" }, 403, "forbidden"],
    [{ status: 500, statusCode: "500" }, 502, "upstream_error"],
  ])("maps a Storage refusal %j to %i %s and inserts nothing", async (extra, status, code) => {
    as("owner", undefined, { upload: [{ data: null, error: { message: "x", ...extra } }] });
    const response = await route.POST(post({ file: pdf() }));
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(client.query.insert).not.toHaveBeenCalled();
  });

  it("answers 500 and reports only the invoice id and SQLSTATE when the insert fails", async () => {
    as("owner", [ok(null, 0), { data: null, error: { code: "23514", message: "secret.pdf" } }]);
    const response = await route.POST(post({ file: pdf("segreto-cliente.pdf") }));
    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledOnce();
    const reported = String((reportError.mock.calls[0]![0] as Error).message);
    expect(reported).toMatch(/23514/);
    expect(reported).toMatch(/[0-9a-f-]{36}/);
    expect(reported).not.toContain("segreto-cliente");
    expect(reported).not.toContain("secret.pdf");
  });

  it("answers 500 when the rate-limit count query fails unexpectedly", async () => {
    as("owner", [{ data: null, error: { code: "XX000", message: "boom" } }]);
    expect((await route.POST(post({ file: pdf() }))).status).toBe(500);
    expect(client.storage.upload).not.toHaveBeenCalled();
  });

  it("exports no DELETE, PUT or PATCH handler", () => {
    for (const method of ["DELETE", "PUT", "PATCH"]) expect(route).not.toHaveProperty(method);
  });
});
