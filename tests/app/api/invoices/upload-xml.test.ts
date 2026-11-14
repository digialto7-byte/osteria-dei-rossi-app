import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XmlImportPayload } from "@/server/fatturapa/schema";
import {
  claimsFor,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { fakePdf } from "../../../helpers/fake-files";
import { buildSignedData } from "../../../fixtures/fatturapa/build-cms";
import {
  bytesOf,
  fileXml,
  nested,
  root,
  type BodySpec,
  type FileSpec,
} from "../../../fixtures/fatturapa/build-xml";

let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/invoices/route");
const { MAX_UPLOADS_PER_HOUR } = await import("@/server/invoices/constants");

const URL_ = "http://localhost:3000/api/invoices";
const TENANT = OWNER_CLAIMS.tenant_id;
const FIRST = "2b000000-0000-4000-8000-0000000000b1";
const ROW = {
  id: FIRST,
  status: "review",
  source: "upload",
  file_mime: "application/xml",
  file_size_bytes: 10,
  original_filename: "fattura.xml",
  created_at: "2026-12-31T23:30:00.000Z",
};
const ok = (data: unknown, count: number | null = null): FakeResult => ({
  data,
  error: null,
  count,
});
const PRECHECK_OK = { alreadyUploaded: [], buyer: "match", issuedByTenant: false };
const importedFor = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? FIRST : `2b000000-0000-4000-8000-0000000000b${i + 1}`,
    bodyIndex: i + 1,
    status: "review",
    duplicateOf: null,
  }));

function as(
  role: string,
  options: {
    count?: number;
    precheck?: FakeResult;
    imported?: FakeResult;
    bodies?: number;
    upload?: { data: unknown; error: { message: string; statusCode?: string } | null }[];
  } = {},
) {
  client = fakeSupabase({
    claims: claimsFor(role),
    results: { invoice: [ok(null, options.count ?? 0), ok(ROW)] },
    rpc: {
      invoice_xml_precheck: [options.precheck ?? ok(PRECHECK_OK)],
      import_xml_invoices: [options.imported ?? ok(importedFor(options.bodies ?? 1))],
    },
    storage: options.upload ? { upload: options.upload } : {},
  });
}

type Part = { bytes: Uint8Array; type: string; name: string };
function post(file: Part): Request {
  const form = new FormData();
  form.append("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
  return new Request(URL_, {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-length": "1000" },
    body: form,
  });
}
const xmlPart = (spec: FileSpec | string = {}, name = "IT01234567890_00001.xml"): Part => ({
  bytes: bytesOf(typeof spec === "string" ? spec : fileXml(spec)),
  type: "application/xml",
  name,
});
const upload = (spec?: FileSpec | string) => route.POST(post(xmlPart(spec)));
const one = (body: BodySpec): FileSpec => ({ bodies: [body] });

const sideEffects = () => ({
  uploads: client.storage.upload.mock.calls.length,
  rpcs: client.rpc.mock.calls.length,
  inserts: client.query.insert.mock.calls.length,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
  reportError.mockReset();
  as("owner");
});
afterEach(() => vi.useRealTimers());

describe("POST /api/invoices with an XML file", () => {
  it("parses, prechecks, uploads, then imports, in that order, and answers 201", async () => {
    const response = await upload();
    expect(response.status).toBe(201);

    const order = [
      client.query.gte.mock.invocationCallOrder[0]!,
      client.rpc.mock.invocationCallOrder[0]!,
      client.storage.upload.mock.invocationCallOrder[0]!,
      client.rpc.mock.invocationCallOrder[1]!,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(client.rpc.mock.calls.map((call) => call[0])).toEqual([
      "invoice_xml_precheck",
      "import_xml_invoices",
    ]);
    expect(client.rpc.mock.calls[0]![1]).toEqual({
      p_sha256: createHash("sha256").update(xmlPart().bytes).digest("hex"),
      p_supplier_vat: "IT12345678903",
      p_buyer_vat: "IT00000000000",
      p_buyer_cf: null,
    });

    const [path, , options] = client.storage.upload.mock.calls[0] as [
      string,
      Uint8Array,
      Record<string, unknown>,
    ];
    expect(path).toMatch(new RegExp(`^${TENANT}/2027/[0-9a-f-]{36}\\.xml$`));
    expect(options).toEqual({ contentType: "application/xml", upsert: false });

    const body = await response.json();
    expect(response.headers.get("location")).toBe(`/api/invoices/${FIRST}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.invoice).toEqual({
      id: FIRST,
      status: "review",
      source: "upload",
      fileMime: "application/xml",
      fileSizeBytes: 10,
      originalFilename: "fattura.xml",
      createdAt: "2026-12-31T23:30:00.000Z",
    });
    expect(body.invoices).toEqual([
      {
        id: FIRST,
        status: "review",
        bodyIndex: 1,
        bodyCount: 1,
        number: "FT 12",
        invoiceDate: "1998-11-03",
        supplierName: "Fornitore Demo 1",
        grossTotal: 12.2,
        duplicateOf: null,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(path);
  });

  it("sends an import payload that passes the strict schema, with the sha of the file and the stored size", async () => {
    await upload();
    const payload = client.rpc.mock.calls[1]![1] as { p_payload: unknown };
    const parsed = XmlImportPayload.safeParse(payload.p_payload);
    expect(parsed.success).toBe(true);
    const { invoices, sha256, buyer } = parsed.data!;
    expect(sha256).toBe(createHash("sha256").update(xmlPart().bytes).digest("hex"));
    expect(buyer).toEqual({ vat: "IT00000000000", cf: null });
    expect(invoices[0]).toMatchObject({
      fileMime: "application/xml",
      fileSizeBytes: xmlPart().bytes.length,
      originalFilename: "IT01234567890_00001.xml",
      bodyIndex: 1,
    });
    const [path] = client.storage.upload.mock.calls[0] as [string];
    expect(invoices[0]!.filePath).toBe(path);
    expect(Object.keys(payload)).toEqual(["p_payload"]);
  });

  it("stores a p7m as uploaded, keyed by the sha of the XML inside", async () => {
    const inner = bytesOf(fileXml());
    const p7m = buildSignedData({ content: inner });
    const response = await route.POST(
      post({ bytes: p7m, type: "application/pkcs7-mime", name: "fattura.xml.p7m" }),
    );
    expect(response.status).toBe(201);
    const [path, stored, options] = client.storage.upload.mock.calls[0] as [
      string,
      Uint8Array,
      Record<string, unknown>,
    ];
    expect(path).toMatch(/\.p7m$/);
    expect(stored).toEqual(p7m);
    expect(options).toEqual({ contentType: "application/pkcs7-mime", upsert: false });
    const args = client.rpc.mock.calls[0]![1] as { p_sha256: string };
    expect(args.p_sha256).toBe(createHash("sha256").update(inner).digest("hex"));
  });

  it("uploads one copy per body and imports them in one call", async () => {
    as("owner", { bodies: 3 });
    const response = await upload({
      bodies: [{ numero: "FT 1" }, { numero: "FT 2" }, { numero: "FT 3" }],
    });
    expect(response.status).toBe(201);
    expect(client.storage.upload).toHaveBeenCalledTimes(3);
    expect(client.rpc.mock.calls.filter((c) => c[0] === "import_xml_invoices")).toHaveLength(1);
    const paths = client.storage.upload.mock.calls.map((c) => c[0] as string);
    expect(new Set(paths).size).toBe(3);
    const body = await response.json();
    expect(
      body.invoices.map((i: { number: string; bodyCount: number }) => [i.number, i.bodyCount]),
    ).toEqual([
      ["FT 1", 3],
      ["FT 2", 3],
      ["FT 3", 3],
    ]);
    expect(body.invoice.id).toBe(FIRST);
  });

  it("reports a duplicate body with the invoice it duplicates", async () => {
    const duplicateOf = "2b000000-0000-4000-8000-0000000000d1";
    as("owner", { imported: ok([{ id: FIRST, bodyIndex: 1, status: "duplicate", duplicateOf }]) });
    const body = await (await upload()).json();
    expect(body.invoices[0]).toMatchObject({ status: "duplicate", duplicateOf });
  });

  it("works for an admin", async () => {
    as("admin");
    expect((await upload()).status).toBe(201);
  });
});

describe("a document type that is not a code", () => {
  it("is refused with a neutral message that never quotes the file", async () => {
    const response = await upload(one({ td: "Mario Rossi RSSMRA80A01H501U" }));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("xml_document_type_unsupported");
    expect(body.error.message).toBe(
      "Tipo di documento non riconosciuto. Passalo al commercialista.",
    );
    expect(JSON.stringify(body)).not.toMatch(/Mario|RSSMRA/);
  });
});

describe("a file Costì refuses is refused before anything is stored", () => {
  const cases: [
    string,
    FileSpec | string,
    number,
    string,
    Record<string, unknown>[] | undefined,
  ][] = [
    ["a damaged file", `${root("<a>")}`.slice(0, 120), 422, "xml_unreadable", undefined],
    ["a DOCTYPE", `<?xml version="1.0"?><!DOCTYPE a><a/>`, 422, "xml_unreadable", undefined],
    [
      "an XML file that is not an invoice",
      `<?xml version="1.0"?><a/>`,
      422,
      "xml_not_fatturapa",
      undefined,
    ],
    [
      "a simplified invoice",
      `<p:FatturaElettronicaSemplificata xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.0" versione="FSM10"/>`,
      422,
      "xml_simplified_unsupported",
      undefined,
    ],
    [
      "a credit note",
      one({ td: "TD04" }),
      422,
      "xml_document_type_unsupported",
      [{ body: 1, code: "TD04", label: "Nota di credito" }],
    ],
    [
      "a self-invoice",
      one({ td: "TD17" }),
      422,
      "xml_document_type_unsupported",
      [
        {
          body: 1,
          code: "TD17",
          label: "Integrazione o autofattura per acquisto di servizi dall'estero",
        },
      ],
    ],
    [
      "a foreign currency",
      one({ divisa: "USD" }),
      422,
      "xml_content_unsupported",
      [{ body: 1, reason: "currency" }],
    ],
    [
      "a negative line",
      one({ lines: [{ total: "-1.00" }] }),
      422,
      "xml_content_unsupported",
      [{ body: 1, line: 1, reason: "negative_line" }],
    ],
    [
      "a missing number",
      one({ numero: null }),
      422,
      "xml_invalid_content",
      [{ body: 1, field: "DatiGeneraliDocumento.Numero" }],
    ],
  ];
  it.each(cases)("%s", async (_name, spec, status, code, details) => {
    const response = await upload(spec);
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.code).toBe(code);
    if (details) expect(body.error.details).toEqual(details);
    expect(sideEffects()).toEqual({ uploads: 0, rpcs: 0, inserts: 0 });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("an unreadable p7m (a detached signature)", async () => {
    const response = await route.POST(
      post({
        bytes: buildSignedData({ content: null }),
        type: "application/pkcs7-mime",
        name: "x.p7m",
      }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("p7m_unreadable");
    expect(sideEffects()).toEqual({ uploads: 0, rpcs: 0, inserts: 0 });
  });

  it("a file that is too deep or too large for the reader", async () => {
    const response = await upload(root(nested(40)));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("xml_unreadable");
    expect(sideEffects().uploads).toBe(0);
  });

  it("an XML file declared as a PDF is refused with 415 before it is read", async () => {
    const response = await route.POST(
      post({ ...xmlPart(), name: "a.pdf", type: "application/pdf" }),
    );
    expect(response.status).toBe(415);
    expect(sideEffects()).toEqual({ uploads: 0, rpcs: 0, inserts: 0 });
  });

  it("an already uploaded file: 409 with the first invoice id, no upload", async () => {
    as("owner", {
      precheck: ok({
        alreadyUploaded: [{ id: FIRST, bodyIndex: 1, status: "review" }],
        buyer: "match",
        issuedByTenant: false,
      }),
    });
    const response = await upload();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("already_uploaded");
    expect(body.error.details).toEqual({ invoiceId: FIRST });
    expect(client.storage.upload).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls.map((c) => c[0])).toEqual(["invoice_xml_precheck"]);
  });

  it.each([
    [
      "another buyer",
      { alreadyUploaded: [], buyer: "mismatch", issuedByTenant: false },
      "xml_not_addressed_to_tenant",
    ],
    [
      "the venue as the issuer",
      { alreadyUploaded: [], buyer: "match", issuedByTenant: true },
      "xml_issued_by_tenant",
    ],
  ])("%s: 422 and no upload", async (_name, precheck, code) => {
    as("owner", { precheck: ok(precheck) });
    const response = await upload();
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe(code);
    expect(client.storage.upload).not.toHaveBeenCalled();
  });

  it("a precheck that fails in the database is an error reported by SQLSTATE only", async () => {
    as("owner", { precheck: { data: null, error: { code: "XX000", message: "SECRET-SUPPLIER" } } });
    expect((await upload()).status).toBe(500);
    expect(String((reportError.mock.calls[0]![0] as Error).message)).not.toContain("SECRET");
    expect(client.storage.upload).not.toHaveBeenCalled();
  });
});

describe("failures after the file is accepted", () => {
  it("a Storage failure on the second body: 502, the import is not called, the orphan is reported by id and status", async () => {
    as("owner", {
      bodies: 2,
      upload: [
        { data: { path: "x" }, error: null },
        { data: null, error: { message: "SECRET bucket text", statusCode: "500" } },
      ],
    });
    const response = await upload({ bodies: [{ numero: "FT 1" }, { numero: "FT 2" }] });
    expect(response.status).toBe(502);
    expect(client.rpc.mock.calls.map((c) => c[0])).toEqual(["invoice_xml_precheck"]);
    expect(reportError).toHaveBeenCalledOnce();
    const message = String((reportError.mock.calls[0]![0] as Error).message);
    expect(message).toMatch(/[0-9a-f-]{36}/);
    expect(message).toMatch(/500/);
    expect(message).not.toContain("SECRET");
    expect(message).not.toContain("Fornitore");
  });

  it("a Storage refusal on the first body is mapped like a PDF's, with nothing orphaned", async () => {
    as("owner", { upload: [{ data: null, error: { message: "x", statusCode: "403" } }] });
    const response = await upload();
    expect(response.status).toBe(403);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("a race on the same file: the import's already_uploaded is a 409 with the id", async () => {
    as("owner", {
      imported: {
        data: null,
        error: { code: "P0001", message: "already_uploaded", details: FIRST },
      },
    });
    const response = await upload();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("already_uploaded");
    expect(body.error.details).toEqual({ invoiceId: FIRST });
  });

  it.each([
    ["xml_not_addressed_to_tenant", 422],
    ["xml_issued_by_tenant", 422],
  ])("the import's %s is %i", async (message, status) => {
    as("owner", { imported: { data: null, error: { code: "P0001", message } } });
    const response = await upload();
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(message);
  });

  it.each(["file_missing", "invalid_request"])(
    "the import's %s is a 500 reported by its code only",
    async (message) => {
      as("owner", {
        imported: { data: null, error: { code: "P0001", message, details: "SECRET detail" } },
      });
      expect((await upload()).status).toBe(500);
      const reported = String((reportError.mock.calls[0]![0] as Error).message);
      expect(reported).toContain(message);
      expect(reported).not.toContain("SECRET");
    },
  );

  describe("objects left in Storage by a failed import are reported by id and code only", () => {
    const storedIds = () =>
      client.storage.upload.mock.calls.map((call) =>
        String(call[0]).replace(/^.*\/([0-9a-f-]{36})\.xml$/, "$1"),
      );
    const reportedMessages = () =>
      reportError.mock.calls.map((call) => String((call[0] as Error).message));

    it.each([
      [
        "the double-tap race (already_uploaded)",
        { code: "P0001", message: "already_uploaded", details: FIRST },
        409,
        "already_uploaded",
        "P0001 already_uploaded",
      ],
      ["a role refusal (42501)", { code: "42501", message: "SECRET x" }, 403, "forbidden", "42501"],
      [
        "a generic error",
        { code: "XX000", message: "SECRET Fornitore Demo 1 12.20" },
        500,
        undefined,
        "XX000",
      ],
    ])("%s", async (_name, error, status, apiCode, reportedCode) => {
      as("owner", { bodies: 2, imported: { data: null, error } });
      const response = await upload({ bodies: [{ numero: "FT 1" }, { numero: "FT 2" }] });
      expect(response.status).toBe(status);
      if (apiCode) expect((await response.json()).error.code).toBe(apiCode);

      const ids = storedIds();
      expect(ids).toHaveLength(2);
      const stored = reportedMessages().filter((m) => m.includes(ids[0]!));
      expect(stored).toHaveLength(1);
      expect(stored[0]).toContain(ids[1]!);
      expect(stored[0]).toContain(reportedCode);
      expect(stored[0]).toBe(
        `E-invoice import failed after upload (${reportedCode}); objects left in storage for invoices ${ids.join(", ")}`,
      );
      for (const message of reportedMessages()) {
        expect(message).not.toMatch(/SECRET|Fornitore|12\.20|IT12345678903/);
      }
    });
  });

  it("a role refusal from the import is a 403", async () => {
    as("owner", { imported: { data: null, error: { code: "42501", message: "x" } } });
    expect((await upload()).status).toBe(403);
  });
});

describe("limits and roles", () => {
  it("counts bodies against the hourly limit: 59 and a two-body file is 429, with nothing stored", async () => {
    as("owner", { count: MAX_UPLOADS_PER_HOUR - 1 });
    const response = await upload({ bodies: [{ numero: "FT 1" }, { numero: "FT 2" }] });
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("rate_limited");
    expect(client.storage.upload).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("lets one body through at 59, refuses at 60 before reading the file", async () => {
    as("owner", { count: MAX_UPLOADS_PER_HOUR - 1 });
    expect((await upload()).status).toBe(201);
    as("owner", { count: MAX_UPLOADS_PER_HOUR });
    expect((await upload()).status).toBe(429);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["waiter", "chef"])("answers 403 for a %s with no work done", async (role) => {
    as(role);
    expect((await upload()).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.storage.upload).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("leaves the PDF path as it was: 202 and the old reply", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      results: {
        invoice: [ok(null, 0), ok({ ...ROW, status: "received", file_mime: "application/pdf" })],
      },
    });
    const response = await route.POST(
      post({ bytes: fakePdf(), type: "application/pdf", name: "f.pdf" }),
    );
    expect(response.status).toBe(202);
    expect(Object.keys(await response.json())).toEqual(["invoice"]);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("what is logged", () => {
  const SECRET = {
    name: "SECRET-SUPPLIER-NAME",
    number: "SECRET-9876",
    description: "SECRET-DESCRIPTION",
    vat: "IT12345678903",
  };
  const secretFile = fileXml({
    supplierName: SECRET.name,
    bodies: [{ numero: SECRET.number, lines: [{ desc: SECRET.description }] }],
  });

  const twoBodies = fileXml({
    supplierName: SECRET.name,
    bodies: [{ numero: SECRET.number, lines: [{ desc: SECRET.description }] }, { numero: "FT 2" }],
  });

  it("never carries names, numbers, VAT numbers, descriptions or amounts, on any failure path", async () => {
    const consoles = (["log", "warn", "error", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const runs: (() => Promise<Response>)[] = [
      async () => {
        as("owner", {
          upload: [
            { data: { path: "x" }, error: null },
            { data: null, error: { message: "boom", statusCode: "500" } },
          ],
          bodies: 2,
        });
        return upload(twoBodies);
      },
      async () => {
        as("owner", {
          imported: {
            data: null,
            error: { code: "P0001", message: "file_missing", details: SECRET.name },
          },
        });
        return upload(secretFile);
      },
      async () => {
        as("owner", { precheck: { data: null, error: { code: "XX000", message: SECRET.name } } });
        return upload(secretFile);
      },
      async () => {
        as("owner");
        return upload(secretFile.replace("<IdCodice>12345678903", "<IdCodice>99999999999"));
      },
    ];
    for (const run of runs) await run();
    const seen = JSON.stringify([
      ...reportError.mock.calls.map((c) => String((c[0] as Error).message)),
      ...consoles.flatMap((spy) => spy.mock.calls),
    ]);
    for (const secret of [
      SECRET.name,
      SECRET.number,
      SECRET.description,
      "IT12345678903",
      "12345678903",
      "12.20",
      "10.00",
    ]) {
      expect(seen).not.toContain(secret);
    }
  });

  it("an unexpected failure of the reader is a 500 reported by its error name, never its text", async () => {
    const xml = await import("@/server/fatturapa/xml");
    vi.spyOn(xml, "readFatturaXml").mockImplementation(() => {
      throw new TypeError(`SECRET-LIBRARY-MESSAGE ${SECRET.name}`);
    });
    const response = await upload(secretFile);
    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledOnce();
    const message = String((reportError.mock.calls[0]![0] as Error).message);
    expect(message).toContain("TypeError");
    expect(message).not.toContain("SECRET");
    expect(sideEffects().uploads).toBe(0);
    vi.restoreAllMocks();
  });
});
