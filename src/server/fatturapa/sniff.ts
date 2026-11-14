/**
 * What a file claims to be, from its leading bytes: a FatturaPA XML file or a CAdES p7m envelope
 * around one. Pure; reads at most the first few hundred bytes. The deep checks (well-formedness,
 * the envelope structure) happen later; this only decides which door the file goes through.
 */
export type FatturaFileKind = "xml" | "p7m";

// CMS ContentInfo type signedData, 1.2.840.113549.1.7.2, as DER: tag 06, length 9, content.
const SIGNED_DATA_OID = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
const OID_WINDOW = 64;
const TEXT_HEAD_BYTES = 512;
// Enough base64 characters to decode OID_WINDOW bytes and a little more.
const BASE64_HEAD_CHARS = 120;

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const LT = 0x3c;

function isXmlWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0d || byte === 0x0a;
}

function isNameStart(byte: number): boolean {
  return (
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    byte === 0x5f ||
    byte === 0x3a ||
    byte >= 0x80
  );
}

function looksLikeXml(bytes: Uint8Array): boolean {
  let i = UTF8_BOM.every((b, k) => bytes[k] === b) ? UTF8_BOM.length : 0;
  while (i < bytes.length && isXmlWhitespace(bytes[i]!)) i += 1;
  if (bytes[i] !== LT) return false;
  const next = bytes[i + 1];
  // "<?xml" or "<" and a name start character; a comment or a DOCTYPE first is not a FatturaPA file.
  return next === 0x3f ? bytes[i + 2] === 0x78 : next !== undefined && isNameStart(next);
}

export function hasSignedDataHead(der: Uint8Array): boolean {
  if (der[0] !== 0x30) return false;
  const end = Math.min(der.length, OID_WINDOW) - SIGNED_DATA_OID.length;
  for (let start = 1; start <= end; start += 1) {
    if (SIGNED_DATA_OID.every((b, k) => der[start + k] === b)) return true;
  }
  return false;
}

const BASE64_CHAR = /[A-Za-z0-9+/]/;

/** The first bytes of base64 text (optionally in PEM armour), or null when the text is not base64. */
function decodeBase64Head(bytes: Uint8Array): Uint8Array | null {
  const text = Buffer.from(bytes.subarray(0, TEXT_HEAD_BYTES)).toString("latin1");
  let body = text.replace(/^\s*-----BEGIN [A-Z0-9 ]+-----[ \t]*\r?\n/, "");
  body = body.replace(/\s+/g, "");
  let chars = "";
  for (const c of body) {
    if (!BASE64_CHAR.test(c) || chars.length >= BASE64_HEAD_CHARS) break;
    chars += c;
  }
  const whole = chars.length - (chars.length % 4);
  if (whole < 4) return null;
  return new Uint8Array(Buffer.from(chars.slice(0, whole), "base64"));
}

export function sniffFatturaKind(bytes: Uint8Array): FatturaFileKind | null {
  if (hasSignedDataHead(bytes)) return "p7m";
  if (looksLikeXml(bytes)) return "xml";
  const decoded = decodeBase64Head(bytes);
  return decoded && hasSignedDataHead(decoded) ? "p7m" : null;
}
