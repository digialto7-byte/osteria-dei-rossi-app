import { describe, expect, it } from "vitest";
import {
  describeUploadError,
  describeUploadSuccess,
  eInvoiceChip,
  isEInvoiceName,
} from "@/lib/invoices/upload-result";
import { sourceChip } from "@/lib/invoices/invoice-view";
import { FatturaError } from "@/server/fatturapa/errors";
import { fatturaToApiError } from "@/server/invoices/xml-errors";
import { unsupportedFileType } from "@/server/invoices/file-check";

const ID_1 = "1b000000-0000-4000-8000-0000000000a1";
const ID_2 = "1b000000-0000-4000-8000-0000000000a2";
const ID_3 = "1b000000-0000-4000-8000-0000000000a3";

const body = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "review",
  bodyIndex: 1,
  bodyCount: 1,
  number: "FT 12",
  invoiceDate: "1998-11-03",
  supplierName: "Fornitore Demo 1",
  grossTotal: 1234.5,
  duplicateOf: null,
  ...over,
});

describe("isEInvoiceName", () => {
  it.each(["FT12.xml", "FT12.XML", "FT12.xml.p7m", "FT12.P7M"])("%s is an e-invoice name", (name) =>
    expect(isEInvoiceName(name)).toBe(true),
  );
  it.each(["fattura.pdf", "foto.jpg", "xml", "fattura.xml.pdf", ""])("%s is not", (name) =>
    expect(isEInvoiceName(name)).toBe(false),
  );
});

describe("eInvoiceChip", () => {
  it("is the word for an e-invoice name and nothing for a PDF or a photo", () => {
    expect(eInvoiceChip("FT12.xml.p7m")).toBe("Fattura elettronica");
    expect(eInvoiceChip("fattura.pdf")).toBeNull();
    expect(eInvoiceChip(undefined)).toBeNull();
  });
  it("has an English form", () => {
    expect(eInvoiceChip("a.xml", "en")).toBe("E-invoice");
  });
});

describe("sourceChip (the list)", () => {
  it("says XML for an xml file and signed XML for a p7m", () => {
    expect(sourceChip("application/xml")).toBe("XML");
    expect(sourceChip("application/pkcs7-mime")).toBe("XML firmato");
  });
  it("says nothing for a PDF or a photo", () => {
    expect(sourceChip("application/pdf")).toBeNull();
    expect(sourceChip("image/jpeg")).toBeNull();
  });
});

describe("describeUploadSuccess", () => {
  it("is the plain note for a PDF or photo reply (no invoices list)", () => {
    expect(describeUploadSuccess({ invoice: { id: ID_1 } })).toEqual({ kind: "document" });
  });

  it("reads one invoice with its supplier, total and a link to the review", () => {
    const view = describeUploadSuccess({ invoice: { id: ID_1 }, invoices: [body(ID_1)] });
    expect(view).toEqual({
      kind: "xml-one",
      text: "Fattura FT 12 del 03/11/1998 · Fornitore Demo 1 · 1.234,50\u00a0€ letta dal file XML. Controllala e approvala.",
      href: `/fatture/${ID_1}/revisione`,
      linkLabel: "Controlla ora ›",
    });
  });

  it("names a supplier the file left without a name, never a blank", () => {
    const view = describeUploadSuccess({
      invoice: { id: ID_1 },
      invoices: [body(ID_1, { supplierName: "  " })],
    });
    expect(view.kind === "xml-one" && view.text).toContain("Fornitore senza nome");
  });

  it("says a duplicate looks already uploaded, without guessing where from, and links Apri", () => {
    const view = describeUploadSuccess({
      invoice: { id: ID_1 },
      invoices: [body(ID_1, { status: "duplicate", duplicateOf: ID_2 })],
    });
    expect(view).toEqual({
      kind: "xml-duplicate",
      text: "Fattura letta, ma sembra già caricata (FT 12 del 03/11/1998). Aprila per decidere.",
      href: `/fatture/${ID_1}/revisione`,
      linkLabel: "Apri ›",
    });
  });

  it("lists every invoice of a multi-invoice file with its status word", () => {
    const view = describeUploadSuccess({
      invoice: { id: ID_1 },
      invoices: [
        body(ID_1, { bodyIndex: 1, bodyCount: 3 }),
        body(ID_2, { bodyIndex: 2, bodyCount: 3, number: "FT 13", grossTotal: 10 }),
        body(ID_3, {
          bodyIndex: 3,
          bodyCount: 3,
          number: "FT 14",
          status: "duplicate",
          duplicateOf: ID_1,
        }),
      ],
    });
    expect(view.kind).toBe("xml-many");
    if (view.kind !== "xml-many") return;
    expect(view.intro).toBe("Il file conteneva 3 fatture, tutte lette:");
    expect(view.rows.map((row) => [row.id, row.title, row.badge.text, row.badge.tone])).toEqual([
      [ID_1, "FT 12 del 03/11/1998 · 1.234,50\u00a0€", "Da controllare", "warning"],
      [ID_2, "FT 13 del 03/11/1998 · 10,00\u00a0€", "Da controllare", "warning"],
      [ID_3, "FT 14 del 03/11/1998 · 1.234,50\u00a0€", "Sembra già caricata", "neutral"],
    ]);
    expect(view.rows[1]!.href).toBe(`/fatture/${ID_2}/revisione`);
  });
});

describe("describeUploadError", () => {
  const view = (error: Parameters<typeof describeUploadError>[0], name = "FT12.xml") =>
    describeUploadError(error, name);

  it("shows the server's sentence for a refusal of the file", () => {
    const error = fatturaToApiError(new FatturaError("xml_unreadable", "parse"));
    expect(view(error)).toMatchObject({
      message: "Il file XML è danneggiato o non leggibile. Scaricalo di nuovo e riprova.",
      lead: null,
      rows: [],
      openInvoiceId: null,
    });
  });

  it("uses the XML wording for a 413 on an e-invoice name, the server's for a PDF", () => {
    const error = { code: "payload_too_large", message: "Il file è troppo grande (massimo 4 MB)." };
    expect(view(error, "FT12.xml.p7m").message).toBe(
      "Il file supera 4 MB. Succede quando contiene un PDF allegato: scarica dal portale la fattura senza allegati, oppure carica il PDF.",
    );
    expect(view(error, "fattura.pdf").message).toBe(error.message);
  });

  it("links the first invoice for a file already uploaded", () => {
    const error = {
      code: "already_uploaded",
      message: "Questo file è già stato caricato.",
      details: { invoiceId: ID_1 },
    };
    expect(view(error)).toMatchObject({
      message: "Questo file è già stato caricato.",
      openInvoiceId: ID_1,
    });
  });

  it("offers no link when the details are not an invoice id (nothing is guessed)", () => {
    const error = {
      code: "already_uploaded",
      message: "Questo file è già stato caricato.",
      details: { invoiceId: "x" },
    };
    expect(view(error).openInvoiceId).toBeNull();
  });

  it("lists at most five invalid places, naming invoice, line and field", () => {
    const error = fatturaToApiError(
      new FatturaError(
        "xml_invalid_content",
        "invalid",
        Array.from({ length: 7 }, (_, i) => ({ body: 1, line: i + 1, field: "AliquotaIVA" })),
      ),
    );
    const shown = view(error);
    expect(shown.message).toBe("Nel file mancano dati obbligatori o sono scritti male.");
    expect(shown.rows).toHaveLength(5);
    expect(shown.rows[0]).toBe("Fattura 1, riga 1: aliquota IVA");
    expect(shown.lead).toBeNull();
  });

  it("writes a field with no label as the file's own name, and an item with no invoice number without it", () => {
    const error = fatturaToApiError(
      new FatturaError("xml_invalid_content", "invalid", [{ field: "CampoNuovo" }]),
    );
    expect(view(error).rows).toEqual(["CampoNuovo"]);
  });

  it("says nothing was saved when the refusal names an invoice after the first", () => {
    const error = fatturaToApiError(
      new FatturaError("xml_invalid_content", "invalid", [
        { body: 2, field: "DatiRiepilogo.AliquotaIVA" },
      ]),
    );
    const shown = view(error);
    expect(shown.lead).toBe("Nessuna fattura del file è stata salvata.");
    expect(shown.rows).toEqual(["Fattura 2: aliquota IVA"]);
  });

  it("names the line of an unsupported content, when the server gives one", () => {
    const error = fatturaToApiError(
      new FatturaError("xml_content_unsupported", "negative_line", [
        { body: 1, line: 3, reason: "negative_line" },
      ]),
    );
    expect(view(error).rows).toEqual(["Fattura 1, riga 3"]);
  });

  it("keeps the 415 and 429 texts as the server wrote them", () => {
    const unsupported = unsupportedFileType();
    expect(view(unsupported).message).toBe(unsupported.message);
    const limited = { code: "rate_limited", message: "Troppi caricamenti nell'ultima ora." };
    expect(view(limited).message).toBe(limited.message);
  });
});
