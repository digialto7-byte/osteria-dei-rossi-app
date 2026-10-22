import { ApiError } from "@/lib/api/errors";
import {
  KIND_EXTENSIONS,
  KIND_MIME,
  MAX_FILENAME_CHARS,
  MAX_UPLOAD_BYTES,
  type InvoiceFileKind,
} from "@/server/invoices/constants";

export type CheckedInvoiceFile = {
  kind: InvoiceFileKind;
  ext: InvoiceFileKind;
  mime: string;
  sizeBytes: number;
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);
}

/** The file kind from its leading bytes, or null when it is not an accepted kind. */
export function sniffKind(bytes: Uint8Array): InvoiceFileKind | null {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, JPEG_MAGIC)) return "jpg";
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  return null;
}

// The /Encrypt name token, not a longer name such as /EncryptMetadata: it must be followed by
// whitespace, a PDF delimiter or the end of the data.
const ENCRYPT_TOKEN = /\/Encrypt(?=[\s/<>[\](){}%]|$)/;

function isEncryptedPdf(bytes: Uint8Array): boolean {
  return ENCRYPT_TOKEN.test(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1"),
  );
}

const unsupported = () =>
  new ApiError(415, "unsupported_file_type", "Formato non supportato: servono PDF, JPEG o PNG.");

function extensionOf(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : null;
}

/**
 * Validates an uploaded document from its bytes, never from its name alone. Order: empty, too
 * large, signature, declared MIME, file name extension, encrypted PDF.
 */
export function checkInvoiceFile(input: {
  bytes: Uint8Array;
  declaredMime: string;
  filename: string;
}): CheckedInvoiceFile {
  const { bytes, declaredMime, filename } = input;
  if (bytes.byteLength === 0) {
    throw new ApiError(400, "invalid_request", "Il file è vuoto.");
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, "payload_too_large", "Il file è troppo grande (massimo 4 MB).");
  }
  const kind = sniffKind(bytes);
  if (!kind) throw unsupported();
  const mime = KIND_MIME[kind];
  if (declaredMime.trim().toLowerCase() !== mime) throw unsupported();
  const ext = extensionOf(filename);
  if (ext !== null && !KIND_EXTENSIONS[kind].includes(ext)) throw unsupported();
  if (kind === "pdf" && isEncryptedPdf(bytes)) {
    throw new ApiError(
      422,
      "encrypted_pdf",
      "Il PDF è protetto da password. Salvalo di nuovo senza protezione e riprova.",
    );
  }
  return { kind, ext: kind, mime, sizeBytes: bytes.byteLength };
}

// Control characters and Unicode bidirectional controls (they can disguise a file name).
const CONTROL_OR_BIDI = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu;

/**
 * A display-safe file name: basename only, NFC, no control or bidi characters, at most
 * MAX_FILENAME_CHARS characters. Stored as metadata, never used in a storage path.
 */
export function sanitiseFilename(name: string): string | null {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(CONTROL_OR_BIDI, "")
    .trim();
  if (base === "" || base === "." || base === "..") return null;
  const capped = Array.from(base).slice(0, MAX_FILENAME_CHARS).join("").trim();
  return capped === "" ? null : capped;
}
