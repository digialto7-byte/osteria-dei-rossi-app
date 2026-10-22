// Tiny in-memory fake documents for tests. Only the leading signature (and, for the encrypted PDF,
// the trailer) is realistic; none of these is a renderable file.
const enc = new TextEncoder();

export function textBytes(text = "Questo non è un PDF."): Uint8Array {
  return enc.encode(text);
}

export function fakePdf(): Uint8Array {
  return enc.encode(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  );
}

export function fakeEncryptedPdf(): Uint8Array {
  return enc.encode(
    "%PDF-1.6\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF\n",
  );
}

/** A PDF that only mentions the longer name /EncryptMetadata, which is not encryption. */
export function fakePdfWithEncryptMetadata(): Uint8Array {
  return enc.encode("%PDF-1.7\n<< /Type /Metadata /EncryptMetadata true >>\n%%EOF\n");
}

export function fakeJpeg(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
  ]);
}

export function fakePng(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

/** HEIC: an ISO base media "ftyp" box with brand "heic". */
export function fakeHeic(): Uint8Array {
  return Uint8Array.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
  ]);
}

/** The given bytes padded with zeros to exactly `size` bytes. */
export function padTo(bytes: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(bytes.subarray(0, size));
  return out;
}
