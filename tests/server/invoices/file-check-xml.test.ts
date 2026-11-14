import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { MAX_UPLOAD_BYTES } from "@/server/invoices/constants";
import { checkInvoiceFile, sniffKind } from "@/server/invoices/file-check";
import { sniffFatturaKind } from "@/server/fatturapa/sniff";
import { fakeJpeg, fakePdf, fakePng, padTo, textBytes } from "../../helpers/fake-files";

const enc = new TextEncoder();

/** The first bytes of a CMS ContentInfo of type signedData (RFC 5652): SEQUENCE, then OID 1.2.840.113549.1.7.2. */
const DER_HEAD = [
  0x30, 0x82, 0x01, 0x00, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02, 0xa0,
  0x82, 0x00, 0xf0,
];
const derP7m = (): Uint8Array => Uint8Array.from([...DER_HEAD, ...new Array<number>(40).fill(0)]);
const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const wrap = (text: string, width: number): string =>
  text.match(new RegExp(`.{1,${width}}`, "g"))!.join("\r\n");

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<p:FatturaElettronica versione="FPR12"/>';

function rejection(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected the check to throw");
}

describe("sniffFatturaKind", () => {
  it.each([
    ["an XML declaration", XML],
    ["a UTF-8 BOM before the declaration", "﻿" + XML],
    ["leading white space", "  \r\n\t" + XML],
    ["a prefixed root without a declaration", '<p:FatturaElettronica versione="FPR12"/>'],
    ["a default-namespace root", '<FatturaElettronica xmlns="x"/>'],
  ])("recognises xml: %s", (_name, text) => {
    expect(sniffFatturaKind(enc.encode(text))).toBe("xml");
  });

  it("recognises a DER p7m by the signedData OID within the first 64 bytes", () => {
    expect(sniffFatturaKind(derP7m())).toBe("p7m");
  });

  it("does not take a DER file whose OID is not signedData", () => {
    const bytes = derP7m();
    bytes[14] = 0x03; // 1.2.840.113549.1.7.3 (envelopedData)
    expect(sniffFatturaKind(bytes)).toBeNull();
  });

  it("does not take a DER file whose OID lies beyond the first 64 bytes", () => {
    const bytes = Uint8Array.from([
      0x30,
      0x82,
      0x01,
      0x00,
      ...new Array<number>(70).fill(0),
      ...DER_HEAD.slice(4),
    ]);
    expect(sniffFatturaKind(bytes)).toBeNull();
  });

  it("recognises a base64 p7m, wrapped or not", () => {
    const text = base64Of(derP7m());
    expect(sniffFatturaKind(enc.encode(text))).toBe("p7m");
    expect(sniffFatturaKind(enc.encode(wrap(text, 16)))).toBe("p7m");
  });

  it("recognises a PEM p7m", () => {
    const pem = `-----BEGIN PKCS7-----\n${wrap(base64Of(derP7m()), 64)}\n-----END PKCS7-----\n`;
    expect(sniffFatturaKind(enc.encode(pem))).toBe("p7m");
  });

  it.each([
    ["random text", textBytes()],
    ["empty input", new Uint8Array()],
    ["a lone angle bracket", enc.encode("<")],
    ["a comment first", enc.encode("<!-- x --><a/>")],
    ["an angle bracket then a digit", enc.encode("<1/>")],
    [
      "base64 of something else",
      enc.encode(
        base64Of(enc.encode("hello world, this is not a CMS envelope at all, not at all")),
      ),
    ],
    ["a UTF-16 BOM", Uint8Array.from([0xff, 0xfe, 0x3c, 0x00])],
    ["a PDF", fakePdf()],
  ])("returns null for %s", (_name, bytes) => {
    expect(sniffFatturaKind(bytes)).toBeNull();
  });
});

describe("sniffKind with the e-invoice kinds", () => {
  it("returns xml and p7m, and leaves pdf, jpg and png alone", () => {
    expect(sniffKind(enc.encode(XML))).toBe("xml");
    expect(sniffKind(derP7m())).toBe("p7m");
    expect(sniffKind(fakePdf())).toBe("pdf");
    expect(sniffKind(fakeJpeg())).toBe("jpg");
    expect(sniffKind(fakePng())).toBe("png");
    expect(sniffKind(textBytes())).toBeNull();
  });
});

describe("checkInvoiceFile for xml", () => {
  const bytes = enc.encode(XML);

  it.each([
    ["application/xml", "fattura.xml"],
    ["text/xml", "fattura.xml"],
    ["application/octet-stream", "fattura.XML"],
    ["", "fattura.xml"],
    ["application/xml", "IT01234567890_FPR01"],
  ])("accepts %j named %s and answers the canonical type", (declaredMime, filename) => {
    expect(checkInvoiceFile({ bytes, declaredMime, filename })).toEqual({
      kind: "xml",
      ext: "xml",
      mime: "application/xml",
      sizeBytes: bytes.byteLength,
    });
  });

  it.each([
    ["image/png", "a.xml"],
    ["application/pdf", "a.xml"],
    ["application/pkcs7-mime", "a.xml"],
    ["application/xml", "a.pdf"],
    ["application/xml", "a.p7m"],
    ["application/xml", "a.exe"],
  ])("refuses %j named %s with 415", (declaredMime, filename) => {
    const error = rejection(() => checkInvoiceFile({ bytes, declaredMime, filename }));
    expect([error.status, error.code]).toEqual([415, "unsupported_file_type"]);
  });
});

describe("checkInvoiceFile for p7m", () => {
  const der = derP7m();

  it.each([
    ["application/pkcs7-mime", "a.xml.p7m"],
    ["application/x-pkcs7-mime", "a.xml.p7m"],
    ["application/octet-stream", "a.P7M"],
    ["", "a.p7m"],
  ])("accepts %j named %s and answers the canonical type", (declaredMime, filename) => {
    expect(checkInvoiceFile({ bytes: der, declaredMime, filename })).toEqual({
      kind: "p7m",
      ext: "p7m",
      mime: "application/pkcs7-mime",
      sizeBytes: der.byteLength,
    });
  });

  it.each([
    ["application/xml", "a.p7m"],
    ["application/pkcs7-mime", "a.xml"],
    ["application/pkcs7-mime", "a.pdf"],
    ["image/png", "a.p7m"],
  ])("refuses %j named %s with 415", (declaredMime, filename) => {
    const error = rejection(() => checkInvoiceFile({ bytes: der, declaredMime, filename }));
    expect([error.status, error.code]).toEqual([415, "unsupported_file_type"]);
  });
});

describe("checkInvoiceFile limits are unchanged for the new kinds", () => {
  it("refuses an empty file with 400", () => {
    const error = rejection(() =>
      checkInvoiceFile({
        bytes: new Uint8Array(),
        declaredMime: "application/xml",
        filename: "a.xml",
      }),
    );
    expect([error.status, error.code]).toEqual([400, "invalid_request"]);
  });

  it("refuses MAX_UPLOAD_BYTES + 1 with 413 and accepts exactly MAX_UPLOAD_BYTES", () => {
    const head = enc.encode(XML);
    const ok = checkInvoiceFile({
      bytes: padTo(head, MAX_UPLOAD_BYTES),
      declaredMime: "application/xml",
      filename: "a.xml",
    });
    expect(ok.sizeBytes).toBe(MAX_UPLOAD_BYTES);
    const error = rejection(() =>
      checkInvoiceFile({
        bytes: padTo(head, MAX_UPLOAD_BYTES + 1),
        declaredMime: "application/xml",
        filename: "a.xml",
      }),
    );
    expect([error.status, error.code]).toEqual([413, "payload_too_large"]);
  });

  it("keeps the PDF canonical-type rule: an XML type for PDF bytes is refused", () => {
    const error = rejection(() =>
      checkInvoiceFile({ bytes: fakePdf(), declaredMime: "application/xml", filename: "a.pdf" }),
    );
    expect(error.status).toBe(415);
  });
});
