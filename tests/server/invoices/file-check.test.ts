import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { MAX_FILENAME_CHARS, MAX_UPLOAD_BYTES } from "@/server/invoices/constants";
import { checkInvoiceFile, sanitiseFilename, sniffKind } from "@/server/invoices/file-check";
import {
  fakeEncryptedPdf,
  fakeHeic,
  fakeJpeg,
  fakePdf,
  fakePdfWithEncryptMetadata,
  fakePng,
  padTo,
  textBytes,
} from "../../helpers/fake-files";

function rejection(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected the check to throw");
}

describe("constants", () => {
  it("pins the upload limit to the bucket limit in the migration", () => {
    expect(MAX_UPLOAD_BYTES).toBe(4_194_304);
  });
});

describe("sniffKind", () => {
  it("recognises pdf, jpg and png by their signature", () => {
    expect(sniffKind(fakePdf())).toBe("pdf");
    expect(sniffKind(fakeJpeg())).toBe("jpg");
    expect(sniffKind(fakePng())).toBe("png");
  });

  it("returns null for text, HEIC and short input", () => {
    expect(sniffKind(textBytes())).toBeNull();
    expect(sniffKind(fakeHeic())).toBeNull();
    expect(sniffKind(Uint8Array.from([0x25, 0x50]))).toBeNull();
    expect(sniffKind(new Uint8Array())).toBeNull();
  });

  it("requires %PDF- at offset 0", () => {
    expect(sniffKind(textBytes("\n%PDF-1.4"))).toBeNull();
  });
});

describe("checkInvoiceFile accepts", () => {
  it.each([
    ["pdf", fakePdf(), "application/pdf", "fattura.pdf", "pdf"],
    ["jpeg", fakeJpeg(), "image/jpeg", "foto.jpeg", "jpg"],
    ["jpeg .jpg", fakeJpeg(), "image/jpeg", "foto.JPG", "jpg"],
    ["png", fakePng(), "image/png", "scan.png", "png"],
  ])("%s", (_name, bytes, mime, filename, ext) => {
    expect(checkInvoiceFile({ bytes, declaredMime: mime, filename })).toEqual({
      kind: ext,
      ext,
      mime,
      sizeBytes: bytes.byteLength,
    });
  });

  it("accepts a file without an extension (camera uploads)", () => {
    expect(
      checkInvoiceFile({ bytes: fakeJpeg(), declaredMime: "image/jpeg", filename: "IMG_0001" }).ext,
    ).toBe("jpg");
  });

  it("accepts exactly MAX_UPLOAD_BYTES", () => {
    const bytes = padTo(fakePdf(), MAX_UPLOAD_BYTES);
    expect(
      checkInvoiceFile({ bytes, declaredMime: "application/pdf", filename: "a.pdf" }).sizeBytes,
    ).toBe(MAX_UPLOAD_BYTES);
  });

  it("does not flag the longer name /EncryptMetadata", () => {
    expect(
      checkInvoiceFile({
        bytes: fakePdfWithEncryptMetadata(),
        declaredMime: "application/pdf",
        filename: "a.pdf",
      }).kind,
    ).toBe("pdf");
  });
});

describe("checkInvoiceFile rejects", () => {
  it("an empty file with 400 invalid_request", () => {
    const error = rejection(() =>
      checkInvoiceFile({
        bytes: new Uint8Array(),
        declaredMime: "application/pdf",
        filename: "a.pdf",
      }),
    );
    expect([error.status, error.code]).toEqual([400, "invalid_request"]);
  });

  it("MAX_UPLOAD_BYTES + 1 with 413 payload_too_large", () => {
    const error = rejection(() =>
      checkInvoiceFile({
        bytes: padTo(fakePdf(), MAX_UPLOAD_BYTES + 1),
        declaredMime: "application/pdf",
        filename: "a.pdf",
      }),
    );
    expect([error.status, error.code]).toEqual([413, "payload_too_large"]);
  });

  it.each([
    ["text renamed .pdf", textBytes(), "application/pdf", "fattura.pdf"],
    ["HEIC photo", fakeHeic(), "image/heic", "IMG_1.heic"],
    ["HEIC declared as jpeg", fakeHeic(), "image/jpeg", "IMG_1.jpg"],
    ["PNG declared as pdf", fakePng(), "application/pdf", "a.pdf"],
    ["JPEG named .png", fakeJpeg(), "image/jpeg", "x.png"],
    ["PDF named .exe", fakePdf(), "application/pdf", "x.exe"],
  ])("%s with 415 unsupported_file_type", (_name, bytes, declaredMime, filename) => {
    const error = rejection(() => checkInvoiceFile({ bytes, declaredMime, filename }));
    expect([error.status, error.code]).toEqual([415, "unsupported_file_type"]);
  });

  it("an encrypted PDF with 422 encrypted_pdf", () => {
    const error = rejection(() =>
      checkInvoiceFile({
        bytes: fakeEncryptedPdf(),
        declaredMime: "application/pdf",
        filename: "a.pdf",
      }),
    );
    expect([error.status, error.code]).toEqual([422, "encrypted_pdf"]);
  });
});

describe("sanitiseFilename", () => {
  it("keeps the basename only", () => {
    expect(sanitiseFilename("../../a.pdf")).toBe("a.pdf");
    expect(sanitiseFilename("C:\\temp\\b.pdf")).toBe("b.pdf");
  });

  it("removes control and bidi characters", () => {
    expect(sanitiseFilename("fat\u0000tura\u202E.pdf\u2066")).toBe("fattura.pdf");
  });

  it("normalises to NFC", () => {
    expect(sanitiseFilename("e\u0301.pdf")).toBe("\u00e9.pdf");
  });

  it("caps the length", () => {
    expect(sanitiseFilename("a".repeat(300))?.length).toBe(MAX_FILENAME_CHARS);
  });

  it("returns null when nothing is left", () => {
    expect(sanitiseFilename("")).toBeNull();
    expect(sanitiseFilename("\u0000\u202E")).toBeNull();
    expect(sanitiseFilename("../")).toBeNull();
  });
});
