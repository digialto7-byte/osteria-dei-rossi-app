import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { venueYear } from "@/lib/time/venue-date";
import { storeInvoiceUpload } from "@/server/invoices/invoices";
import type { InvoiceReview, ReviewLine } from "@/server/invoices/review-types";
import { fakePdf } from "../helpers/fake-files";
import { seedReviewInvoice } from "./helpers/invoices";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import {
  P7M_MIME,
  SUPPLIER_NAME,
  SUPPLIER_VAT,
  XML_MIME,
  asP7m,
  fatturaXml,
  invoiceBody,
  invoiceCountOf,
  objectCount,
  runTag,
  sha256Hex,
  storageEntry,
  tenantVatOf,
  uploadRequest,
  withDoctype,
  type UploadPart,
} from "./helpers/xml";

// P2-7 acceptance tests on the real local stack (Auth, PostgREST, Storage), with real user JWTs. It proves what no
// other layer can: the keys real Storage gives an object (`metadata.size`, `metadata.mimetype`, which the import
// checks), the Content-Disposition of the signed link, and the whole path upload -> precheck -> Storage -> import with
// a 3-body file; then the duplicates, the replace, the refusals that store nothing, and the roles.
// The route handlers run for real (schemas, role check, parser, error mapping, the procedures, RLS); only
// `createSupabaseServerClient`, which would read cookies from a Next.js request, is handed the signed-in test
// user's own client. Fixtures that must bypass RLS use the local secret key. Dates are in 1998 on purpose.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/report", () => ({ reportError }));

const uploadRoute = await import("@/app/api/invoices/route");
const reviewRoute = await import("@/app/api/invoices/[id]/review/route");
const fileUrlRoute = await import("@/app/api/invoices/[id]/file-url/route");
const originalRoute = await import("@/app/api/invoices/[id]/original/route");
const useXmlRoute = await import("@/app/api/invoices/[id]/use-xml/route");
const lineRoute = await import("@/app/api/invoices/[id]/lines/[lineId]/route");
const supplierRoute = await import("@/app/api/invoices/[id]/supplier/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");

const NO_ID = "00000000-0000-4000-8000-000000000000";

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
  review: InvoiceReview;
  error: ErrorBody;
}

interface UploadedItem {
  id: string;
  status: string;
  bodyIndex: number;
  bodyCount: number;
  number: string;
  invoiceDate: string;
  supplierName: string;
  grossTotal: number;
  duplicateOf: string | null;
}

async function toReply(response: Response): Promise<Reply> {
  const body = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    headers: response.headers,
    body,
    review: body.review as InvoiceReview,
    error: body.error as ErrorBody,
  };
}

/** One JSON request to a real route handler, as the given user. */
async function call(
  user: TestUser,
  handler: Handler,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<Reply> {
  session.client = user.client;
  const method = init.method ?? "GET";
  return toReply(
    await handler(
      new Request(`http://localhost:3000${path}`, {
        method,
        headers: method === "GET" ? {} : { "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      { params: Promise.resolve(init.params ?? {}) },
    ),
  );
}

/** GET /api/invoices/:id/original as the given user: the raw response, not parsed JSON. */
async function original(user: TestUser, id: string): Promise<Response> {
  session.client = user.client;
  return originalRoute.GET(new Request(`http://localhost:3000/api/invoices/${id}/original`), {
    params: Promise.resolve({ id }),
  });
}

/** The headers every original is served with: an opaque attachment, never a page. */
function expectAttachmentHeaders(response: Response, filename: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
  expect(response.headers.get("cache-control")).toBe("no-store");
}

/** POST /api/invoices with one file, as the given user. */
async function upload(user: TestUser, part: UploadPart): Promise<Reply> {
  session.client = user.client;
  return toReply(await uploadRoute.POST(uploadRequest(part)));
}

const lineOf = (review: InvoiceReview, description: string): ReviewLine => {
  const found = review.lines.find((line) => line.rawDescription === description);
  if (!found) throw new Error(`No line "${description}" in the review`);
  return found;
};

const bytesOfBlob = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe.skipIf(!env)("XML e-invoice upload on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let vatA: string;
  const tag = runTag();
  const year = venueYear(new Date());
  const ingredientIds = new Map<string, string>();

  // The 3-body signed file of the suite: three invoices of "Fornitore Demo 1", dated 3, 4 and 5 Nov 1998.
  const numbers = [1, 2, 3].map((n) => `FT ${tag}-${n}`);
  const bodyDates = ["1998-11-03", "1998-11-04", "1998-11-05"];
  let p7mXml: Uint8Array;
  let p7mBytes: Uint8Array;
  let p7mPart: UploadPart;
  let p7mIds: string[];

  const getReview = async (id: string, user: TestUser = a.owner) => {
    const reply = await call(user, reviewRoute.GET, `/api/invoices/${id}/review`, {
      params: { id },
    });
    expect(reply.status).toBe(200);
    return reply.review;
  };

  const rowOf = async (id: string) => {
    const read = await stack.admin.from("invoice").select("*").eq("id", id).single();
    expect(read.error).toBeNull();
    return read.data as Record<string, unknown>;
  };

  /** Everything the refusals must leave alone: rows in the tenant and objects in its folder. */
  const footprint = async (tenant: TestTenant) => ({
    invoices: await invoiceCountOf(stack.admin, tenant.id),
    objects: await objectCount(stack.admin, tenant.id, year),
  });

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    vatA = await tenantVatOf(stack.admin, a.id);
    for (const name of ["Farina Demo", "Olio Demo"]) {
      const made = await stack.admin
        .from("ingredient")
        .insert({ tenant_id: a.id, name, base_unit: "kg" })
        .select("id")
        .single();
      expect(made.error).toBeNull();
      ingredientIds.set(name, made.data!.id as string);
    }
    const place = await stack.admin.from("location").insert({ tenant_id: a.id, name: "Cella" });
    expect(place.error).toBeNull();

    p7mXml = fatturaXml(
      vatA,
      numbers.map((numero, index) => invoiceBody(numero, bodyDates[index]!)),
    );
    p7mBytes = asP7m(p7mXml);
    p7mPart = { bytes: p7mBytes, name: "FT-DEMO.xml.p7m", type: P7M_MIME };
  });

  describe("AT-X1, AT-X3, AT-X9: a signed file of 3 invoices goes through the real path", () => {
    it("answers 201 with one invoice per body, read into review, and no model call", async () => {
      const reply = await upload(a.owner, p7mPart);
      expect(reply.status).toBe(201);
      const items = reply.body.invoices as UploadedItem[];
      p7mIds = items.map((item) => item.id);
      expect(items).toEqual(
        [0, 1, 2].map((index) => ({
          id: p7mIds[index],
          status: "review",
          bodyIndex: index + 1,
          bodyCount: 3,
          number: numbers[index],
          invoiceDate: bodyDates[index],
          supplierName: SUPPLIER_NAME,
          grossTotal: 44,
          duplicateOf: null,
        })),
      );
      expect((reply.body.invoice as { id: string }).id).toBe(p7mIds[0]);
      expect(reply.headers.get("location")).toBe(`/api/invoices/${p7mIds[0]}`);
      expect(reportError).not.toHaveBeenCalled();
    });

    it("stored three rows of the file: same sha256 of the unwrapped XML, bodies 1 to 3, never queued", async () => {
      const sha = sha256Hex(p7mXml);
      for (const [index, id] of p7mIds.entries()) {
        const row = await rowOf(id);
        expect(row).toMatchObject({
          tenant_id: a.id,
          status: "review",
          source: "upload",
          file_mime: P7M_MIME,
          file_size_bytes: p7mBytes.byteLength,
          original_filename: "FT-DEMO.xml.p7m",
          document_type: "TD01",
          xml_format: "FPR12",
          xml_sha256: sha,
          xml_body_index: index + 1,
          xml_body_count: 3,
          xml_notes: [],
          supplier_vat: SUPPLIER_VAT,
          supplier_name: SUPPLIER_NAME,
          number_raw: numbers[index],
          invoice_date: bodyDates[index],
          extracted_at: null,
          extraction_model: null,
        });
        expect(Number(row.net_total)).toBe(40);
        expect(Number(row.vat_total)).toBe(4);
        expect(Number(row.gross_total)).toBe(44);
        expect(row.file_path).toBe(`${a.id}/${year}/${id}.p7m`);
      }
    });

    it("real Storage keeps each copy with metadata.size and metadata.mimetype as the import checks them", async () => {
      for (const id of p7mIds) {
        const entry = await storageEntry(stack.admin, `${a.id}/${year}/${id}.p7m`);
        expect(entry, `object of ${id}`).not.toBeNull();
        // The two keys import_xml_invoices reads (metadata ->> 'size' and ->> 'mimetype').
        expect(Number(entry!.metadata.size)).toBe(p7mBytes.byteLength);
        expect(entry!.metadata.mimetype).toBe(P7M_MIME);
        // The original, as uploaded: the signed envelope, not the unwrapped XML.
        const download = await a.owner.client.storage
          .from("invoices")
          .download(`${a.id}/${year}/${id}.p7m`);
        expect(download.error).toBeNull();
        expect(await bytesOfBlob(download.data!)).toEqual(p7mBytes);
      }
    });

    it("the review shows what the file said: signed, VAT summary, first code, other data, totals gate", async () => {
      const review = await getReview(p7mIds[0]!);
      expect(review.invoice.status).toBe("review");
      expect(review.invoice.xml).toEqual({
        format: "FPR12",
        documentType: "TD01",
        documentTypeLabel: "Fattura",
        signed: true,
        bodyIndex: 1,
        bodyCount: 3,
        notes: [],
      });
      expect(review.vatSummary).toEqual([
        { rate: 10, nature: null, natureLabel: null, taxable: 40, tax: 4 },
      ]);
      expect(review.extractedSupplier).toMatchObject({
        name: SUPPLIER_NAME,
        vatNumber: SUPPLIER_VAT,
      });
      expect(review.supplier).toBeNull();
      expect(review.gate.flags).toEqual([]);
      expect(review.gate.totalsDiff).toBe(0);
      expect(review.replaceWithXml).toBeNull();
      expect(review.duplicatePartner).toBeNull();

      expect(review.lines).toHaveLength(2);
      const farina = lineOf(review, "Farina Demo");
      expect(farina).toMatchObject({
        qty: 3,
        unitPrice: 10,
        lineAmount: 30,
        vatRate: 10,
        supplierCode: "8000000000001",
        lotCode: null,
        lotMissing: true,
      });
      expect(farina.xml).toMatchObject({
        lineNumber: 1,
        kind: null,
        codes: [{ type: "EAN", value: "8000000000001" }],
        otherData: [{ type: "LOTTO", text: "L-DEMO-0001", number: null, date: null }],
        discounts: [],
      });
      expect(lineOf(review, "Olio Demo").xml).toMatchObject({ lineNumber: 2, codes: [] });
    });

    it("a .p7m's file-url is the app route, never a Storage URL, and the route serves the original bytes as an attachment", async () => {
      const reply = await call(a.owner, fileUrlRoute.GET, `/api/invoices/${p7mIds[0]}/file-url`, {
        params: { id: p7mIds[0]! },
      });
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({
        url: `/api/invoices/${p7mIds[0]}/original`,
        expiresAt: null,
        disposition: "attachment",
      });
      const response = await original(a.owner, p7mIds[0]!);
      expectAttachmentHeaders(response, "FT-DEMO.xml.p7m");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(p7mBytes);
    });

    it("a PDF's signed link is not an attachment (the control for the header check above)", async () => {
      const stored = await storeInvoiceUpload(
        a.owner.client,
        { tenantId: a.id },
        { bytes: fakePdf(), declaredMime: "application/pdf", filename: "fattura-demo.pdf" },
        new Date(),
      );
      const reply = await call(a.owner, fileUrlRoute.GET, `/api/invoices/${stored.id}/file-url`, {
        params: { id: stored.id },
      });
      expect(reply.status).toBe(200);
      expect(reply.body.disposition).toBe("inline");
      const response = await fetch(reply.body.url as string);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition") ?? "").not.toMatch(/^attachment/i);
      await response.arrayBuffer();
    });
  });

  describe("a plain .xml is stored as application/xml", () => {
    it("imports, keeps the key names Storage gives, and the app route serves it as an attachment", async () => {
      const bytes = fatturaXml(vatA, [invoiceBody(`FT ${tag}-X`, "1998-11-06")]);
      const part = { bytes, name: "IT00000000000_00001.xml", type: XML_MIME };
      const reply = await upload(a.owner, part);
      expect(reply.status).toBe(201);
      const [item] = reply.body.invoices as UploadedItem[];
      expect(item).toMatchObject({ status: "review", bodyIndex: 1, bodyCount: 1 });

      const path = `${a.id}/${year}/${item!.id}.xml`;
      expect((await rowOf(item!.id)).file_path).toBe(path);
      const entry = await storageEntry(stack.admin, path);
      expect(entry).not.toBeNull();
      expect(Number(entry!.metadata.size)).toBe(bytes.byteLength);
      expect(entry!.metadata.mimetype).toBe(XML_MIME);

      const link = await call(a.owner, fileUrlRoute.GET, `/api/invoices/${item!.id}/file-url`, {
        params: { id: item!.id },
      });
      expect(link.body.disposition).toBe("attachment");
      expect(link.body.url).toBe(`/api/invoices/${item!.id}/original`);
      const response = await original(a.owner, item!.id);
      expectAttachmentHeaders(response, "IT00000000000_00001.xml");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });
  });

  describe("AT-X6: the same file again is refused and nothing is stored", () => {
    it("the same .p7m again: 409 already_uploaded, with the first invoice of the file", async () => {
      const before = await footprint(a);
      const reply = await upload(a.owner, p7mPart);
      expect(reply.status).toBe(409);
      expect(reply.error.code).toBe("already_uploaded");
      expect(reply.error.details).toEqual({ invoiceId: p7mIds[0] });
      expect(await footprint(a)).toEqual(before);
    });

    it("its unwrapped .xml is the same file: 409 too, whatever the name and the declared type", async () => {
      const before = await footprint(a);
      const reply = await upload(a.owner, { bytes: p7mXml, name: "copia.xml", type: XML_MIME });
      expect(reply.status).toBe(409);
      expect(reply.error.code).toBe("already_uploaded");
      expect(reply.error.details).toEqual({ invoiceId: p7mIds[0] });
      expect(await footprint(a)).toEqual(before);
    });

    it("owner B uploading A's file is refused as not addressed to their VAT number, and stores nothing", async () => {
      const before = await footprint(b);
      const reply = await upload(b.owner, p7mPart);
      expect(reply.status).toBe(422);
      expect(reply.error.code).toBe("xml_not_addressed_to_tenant");
      expect(await footprint(b)).toEqual(before);
    });
  });

  describe("AT-X4: a refused file stores nothing", () => {
    const refusals: [string, () => Uint8Array, string, number][] = [
      [
        "a DOCTYPE with an entity",
        () => withDoctype(fatturaXml(vatA, [invoiceBody(`FT ${tag}-D`, "1998-11-07")])),
        "xml_unreadable",
        422,
      ],
      [
        "a credit note (TD04)",
        () => fatturaXml(vatA, [invoiceBody(`NC ${tag}-1`, "1998-11-07", { td: "TD04" })]),
        "xml_document_type_unsupported",
        422,
      ],
      [
        "a self-invoice type (TD26)",
        () => fatturaXml(vatA, [invoiceBody(`FT ${tag}-T`, "1998-11-07", { td: "TD26" })]),
        "xml_document_type_unsupported",
        422,
      ],
    ];

    it.each(refusals)(
      "%s: 422 with its code, no row and no object",
      async (_label, build, code, status) => {
        const before = await footprint(a);
        const reply = await upload(a.owner, {
          bytes: build(),
          name: "rifiutata.xml",
          type: XML_MIME,
        });
        expect(reply.status).toBe(status);
        expect(reply.error.code).toBe(code);
        expect(await footprint(a)).toEqual(before);
      },
    );

    it("the credit note and the TD26 name their type in the message and details", async () => {
      const credit = await upload(a.owner, {
        bytes: fatturaXml(vatA, [invoiceBody(`NC ${tag}-2`, "1998-11-07", { td: "TD04" })]),
        name: "nota.xml",
        type: XML_MIME,
      });
      expect(credit.error.message).toContain("nota di credito (TD04)");
      expect(credit.error.details).toMatchObject([{ body: 1, code: "TD04" }]);

      const other = await upload(a.owner, {
        bytes: fatturaXml(vatA, [invoiceBody(`FT ${tag}-U`, "1998-11-07", { td: "TD26" })]),
        name: "tipo.xml",
        type: XML_MIME,
      });
      expect(other.error.message).toContain("(TD26)");
      expect(other.error.details).toMatchObject([{ body: 1, code: "TD26" }]);
    });

    it("a file for another buyer's VAT number is refused before Storage", async () => {
      const before = await footprint(a);
      const reply = await upload(a.owner, {
        bytes: fatturaXml(await tenantVatOf(stack.admin, b.id), [
          invoiceBody(`FT ${tag}-B`, "1998-11-07"),
        ]),
        name: "altro-locale.xml",
        type: XML_MIME,
      });
      expect(reply.status).toBe(422);
      expect(reply.error.code).toBe("xml_not_addressed_to_tenant");
      expect(await footprint(a)).toEqual(before);
    });
  });

  describe("AT-X1, AT-X5: supplier, mapping, lot and approval work as for a PDF", () => {
    let supplierId: string;

    it("'Crea fornitore' from the file's name and VAT links the supplier; the lines wait to be mapped", async () => {
      const before = await getReview(p7mIds[0]!);
      const reply = await call(a.owner, supplierRoute.POST, `/api/invoices/${p7mIds[0]}/supplier`, {
        method: "POST",
        body: {
          create: {
            name: before.extractedSupplier.name,
            vatNumber: before.extractedSupplier.vatNumber,
            paymentTermsDays: 30,
          },
        },
        params: { id: p7mIds[0]! },
      });
      expect(reply.status).toBe(200);
      supplierId = reply.review.supplier!.id;
      expect(reply.review.supplier).toMatchObject({ name: SUPPLIER_NAME, vatNumber: SUPPLIER_VAT });
      const codes = reply.review.approval!.blockers.map((blocker) => blocker.code);
      expect(codes).toEqual(["lines_unmapped"]);
    });

    it("maps both lines; the lot the supplier wrote is copied with the line PATCH 'Usa come lotto' sends", async () => {
      const review = await getReview(p7mIds[0]!);
      for (const description of ["Farina Demo", "Olio Demo"]) {
        const mapped = await call(
          a.owner,
          lineRoute.PATCH,
          `/api/invoices/${p7mIds[0]}/lines/${lineOf(review, description).id}`,
          {
            method: "PATCH",
            body: { ingredientId: ingredientIds.get(description) },
            params: { id: p7mIds[0]!, lineId: lineOf(review, description).id },
          },
        );
        expect(mapped.status, description).toBe(200);
      }
      const farinaId = lineOf(review, "Farina Demo").id;
      const copied = await call(
        a.owner,
        lineRoute.PATCH,
        `/api/invoices/${p7mIds[0]}/lines/${farinaId}`,
        {
          method: "PATCH",
          body: { lotCode: "L-DEMO-0001" },
          params: { id: p7mIds[0]!, lineId: farinaId },
        },
      );
      expect(copied.status).toBe(200);
      expect(lineOf(copied.review, "Farina Demo")).toMatchObject({
        lotCode: "L-DEMO-0001",
        lotMissing: false,
      });
      expect(lineOf(copied.review, "Olio Demo").lotMissing).toBe(true);
      expect(copied.review.approval).toMatchObject({ canApprove: true, blockers: [] });
    });

    it("approves body 1: the payable comes from the file's total and the lots are in the ledgers", async () => {
      const preview = await getReview(p7mIds[0]!);
      // The receipts carry the invoice date of the file, never today's.
      expect(preview.approval!.receiptDate).toBe("1998-11-03");

      const approved = await call(
        a.owner,
        approveRoute.POST,
        `/api/invoices/${p7mIds[0]}/approve`,
        {
          method: "POST",
          body: {},
          params: { id: p7mIds[0]! },
        },
      );
      expect(approved.status).toBe(200);
      expect(approved.review.invoice.status).toBe("approved");
      expect(approved.review.posting).toMatchObject({
        payable: {
          grossAmount: 44,
          amount: 44,
          dueDate: "1998-12-03",
          dueDateSource: "supplier_terms",
          status: "open",
        },
        locationName: "Cella",
      });
      expect(lineOf(approved.review, "Farina Demo").received).toEqual({ qty: 3, unit: "kg" });
      expect(lineOf(approved.review, "Olio Demo").received).toEqual({ qty: 2, unit: "kg" });

      const lots = await a.owner.client.from("raw_lot").select("*");
      expect(lots.error).toBeNull();
      expect(lots.data).toHaveLength(2);
      const farina = lots.data!.find(
        (lot) => lot.ingredient_id === ingredientIds.get("Farina Demo"),
      );
      expect(farina).toMatchObject({
        lot_code: "L-DEMO-0001",
        qty_received: 3,
        received_on: "1998-11-03",
        supplier_id: supplierId,
      });
      const payables = await a.owner.client
        .from("payable")
        .select("*")
        .eq("invoice_id", p7mIds[0]!);
      expect(payables.error).toBeNull();
      expect(payables.data).toHaveLength(1);
      expect(Number(payables.data![0]!.amount)).toBe(44);

      const imported = await a.owner.client
        .from("audit_event")
        .select("action")
        .eq("entity_id", p7mIds[0]!)
        .eq("action", "invoice.imported_xml");
      expect(imported.error).toBeNull();
      expect(imported.data).toHaveLength(1);
    });

    it("the other two bodies of the file are untouched by that approval", async () => {
      for (const id of p7mIds.slice(1)) {
        expect((await rowOf(id)).status).toBe("review");
      }
    });

    it("a file of the approved supplier links its supplier on import (by VAT) with no tap", async () => {
      const reply = await upload(a.owner, {
        bytes: fatturaXml(vatA, [invoiceBody(`FT ${tag}-L`, "1998-11-08")]),
        name: "secondo.xml",
        type: XML_MIME,
      });
      expect(reply.status).toBe(201);
      const [item] = reply.body.invoices as UploadedItem[];
      const review = await getReview(item!.id);
      expect(review.supplier).toMatchObject({ id: supplierId, vatNumber: SUPPLIER_VAT });
    });

    describe("AT-X6: XML against a photo of the same invoice, then 'Usa il file XML'", () => {
      let photoId: string;
      let photoNumber: string;
      let xmlId: string;
      const photoDate = "1998-11-10";

      it("an XML with the key of a photo in review is read as a duplicate of it, with the amounts compared", async () => {
        photoId = await seedReviewInvoice(stack.admin, a.id, {
          supplierId,
          date: photoDate,
          lines: [
            {
              description: "Farina Demo",
              ingredientId: ingredientIds.get("Farina Demo")!,
              qty: 3,
              unit: "kg",
              unitPrice: 10,
            },
            {
              description: "Olio Demo",
              ingredientId: ingredientIds.get("Olio Demo")!,
              qty: 2,
              unit: "kg",
              unitPrice: 5,
            },
          ],
        });
        photoNumber = (await rowOf(photoId)).number_raw as string;

        const reply = await upload(a.owner, {
          bytes: fatturaXml(vatA, [invoiceBody(photoNumber, photoDate)]),
          name: "stessa-fattura.xml",
          type: XML_MIME,
        });
        expect(reply.status).toBe(201);
        const [item] = reply.body.invoices as UploadedItem[];
        xmlId = item!.id;
        expect(item).toMatchObject({ status: "duplicate", duplicateOf: photoId });

        const review = await getReview(xmlId);
        expect(review.invoice.status).toBe("duplicate");
        expect(review.duplicatePartner).toEqual({
          id: photoId,
          number: photoNumber,
          date: photoDate,
          grossTotal: 44,
          format: "document",
          status: "review",
          amountsMatch: true,
        });
        expect(review.replaceWithXml).toEqual({ partnerId: photoId });
      });

      it("a chef and a waiter cannot replace: 403, and the photo is still in review", async () => {
        for (const user of [a.chef, a.waiter]) {
          const reply = await call(user, useXmlRoute.POST, `/api/invoices/${xmlId}/use-xml`, {
            method: "POST",
            body: { replaces: photoId },
            params: { id: xmlId },
          });
          expect(reply.status, user.role).toBe(403);
        }
        expect((await rowOf(photoId)).status).toBe("review");
      });

      it("owner B gets 404 on A's ids and nothing changes", async () => {
        const reply = await call(b.owner, useXmlRoute.POST, `/api/invoices/${xmlId}/use-xml`, {
          method: "POST",
          body: { replaces: photoId },
          params: { id: xmlId },
        });
        expect(reply.status).toBe(404);
        expect(reply.error.code).toBe("not_found");
        expect((await rowOf(photoId)).status).toBe("review");
        expect((await rowOf(xmlId)).status).toBe("duplicate");
      });

      it("'Usa il file XML al posto del PDF': the photo is rejected, the XML goes to review", async () => {
        const reply = await call(a.owner, useXmlRoute.POST, `/api/invoices/${xmlId}/use-xml`, {
          method: "POST",
          body: { replaces: photoId },
          params: { id: xmlId },
        });
        expect(reply.status).toBe(200);
        expect(reply.body).toEqual({ status: "review" });

        expect(await rowOf(photoId)).toMatchObject({ status: "rejected" });
        expect(await rowOf(xmlId)).toMatchObject({ status: "review", duplicate_of: null });

        const review = await getReview(xmlId);
        expect(review.duplicatePartner).toBeNull();
        expect(review.replaceWithXml).toBeNull();
        expect(review.supplier).toMatchObject({ id: supplierId });

        const rejected = await a.owner.client
          .from("audit_event")
          .select("reason")
          .eq("entity_id", photoId)
          .eq("action", "invoice.rejected");
        expect(rejected.data).toEqual([{ reason: "Sostituita dal file XML" }]);
        const replaced = await a.owner.client
          .from("audit_event")
          .select("after")
          .eq("entity_id", xmlId)
          .eq("action", "invoice.replaced_by_xml");
        expect(replaced.data).toEqual([{ after: { other: photoId } }]);
      });

      it("a second tap is refused: 409 replace_not_allowed, and nothing is written twice", async () => {
        const reply = await call(a.owner, useXmlRoute.POST, `/api/invoices/${xmlId}/use-xml`, {
          method: "POST",
          body: { replaces: photoId },
          params: { id: xmlId },
        });
        expect(reply.status).toBe(409);
        expect(reply.error.code).toBe("replace_not_allowed");
        const rejected = await a.owner.client
          .from("audit_event")
          .select("id")
          .eq("entity_id", photoId)
          .eq("action", "invoice.rejected");
        expect(rejected.data).toHaveLength(1);
      });

      it("the same XML again after the replace is still refused: the live XML invoice holds its hash", async () => {
        const reply = await upload(a.owner, {
          bytes: fatturaXml(vatA, [invoiceBody(photoNumber, photoDate)]),
          name: "ancora.xml",
          type: XML_MIME,
        });
        expect(reply.status).toBe(409);
        expect(reply.error.code).toBe("already_uploaded");
        expect(reply.error.details).toEqual({ invoiceId: xmlId });
      });
    });
  });

  describe("AT-X10: roles and tenants", () => {
    it.each([
      ["chef", () => a.chef],
      ["waiter", () => a.waiter],
    ])(
      "a %s gets 403 on upload, review, original, file-url and use-xml, and nothing is stored",
      async (_label, user) => {
        const before = await footprint(a);
        const refused = await upload(user(), {
          bytes: fatturaXml(vatA, [invoiceBody(`FT ${tag}-R`, "1998-11-09")]),
          name: "fattura.xml",
          type: XML_MIME,
        });
        expect(refused.status).toBe(403);
        expect(refused.error.code).toBe("forbidden");
        expect(await footprint(a)).toEqual(before);

        const id = p7mIds[1]!;
        for (const [handler, path, init] of [
          [reviewRoute.GET, `/api/invoices/${id}/review`, {}],
          [originalRoute.GET, `/api/invoices/${id}/original`, {}],
          [fileUrlRoute.GET, `/api/invoices/${id}/file-url`, {}],
          [
            useXmlRoute.POST,
            `/api/invoices/${id}/use-xml`,
            { method: "POST", body: { replaces: NO_ID } },
          ],
        ] as [Handler, string, { method?: string; body?: unknown }][]) {
          const reply = await call(user(), handler, path, { ...init, params: { id } });
          expect(reply.status, path).toBe(403);
        }
      },
    );

    it("owner B gets 404 on A's invoice: review, file-url and original alike", async () => {
      const id = p7mIds[1]!;
      for (const [handler, path] of [
        [reviewRoute.GET, `/api/invoices/${id}/review`],
        [fileUrlRoute.GET, `/api/invoices/${id}/file-url`],
        [originalRoute.GET, `/api/invoices/${id}/original`],
      ] as [Handler, string][]) {
        const reply = await call(b.owner, handler, path, { params: { id } });
        expect(reply.status, path).toBe(404);
        expect(reply.error.code).toBe("not_found");
      }
    });

    it("owner B cannot sign A's stored file directly, and sees none of A's rows", async () => {
      const path = `${a.id}/${year}/${p7mIds[1]}.p7m`;
      const signed = await b.owner.client.storage.from("invoices").createSignedUrl(path, 60);
      expect(signed.error).not.toBeNull();
      const rows = await b.owner.client.from("invoice").select("id").eq("id", p7mIds[1]!);
      expect(rows.data).toEqual([]);
    });

    it("the file's bytes are never reachable by a chef either", async () => {
      const download = await a.chef.client.storage
        .from("invoices")
        .download(`${a.id}/${year}/${p7mIds[1]}.p7m`);
      expect(download.error).not.toBeNull();
    });
  });

  it("no error was reported on the way (a 500 would have gone to the reporter)", () => {
    expect(reportError).not.toHaveBeenCalled();
  });
});
