/**
 * Opens the CAdES (.p7m) envelope of a FatturaPA file: ContentInfo, SignedData,
 * EncapsulatedContentInfo, eContent (RFC 5652 sections 3 and 5). Our own bounded DER/BER reader.
 *
 * What it does NOT do: verify anything. The signature, the certificates and the signer infos are
 * skipped by length and never parsed (decision D-X5: SdI has already checked every signed invoice).
 *
 * The input is hostile. Every length is bounded by the bytes that remain, a definite length is
 * written in at most CMS_MAX_LENGTH_BYTES bytes, recursion stops at CMS_MAX_DEPTH, at most
 * CMS_MAX_TLVS headers are read, and nothing is allocated from a length field before it is
 * checked against the input. No file system, no network, no child process.
 */
import {
  CMS_MAX_DEPTH,
  CMS_MAX_ENVELOPES,
  CMS_MAX_LENGTH_BYTES,
  CMS_MAX_TLVS,
} from "@/server/fatturapa/constants";
import { FatturaError } from "@/server/fatturapa/errors";
import { hasSignedDataHead } from "@/server/fatturapa/sniff";

const fail = (reason: string): never => {
  throw new FatturaError("p7m_unreadable", reason);
};

const TAG_SEQUENCE = 0x30;
const TAG_OID = 0x06;
const TAG_OCTET_STRING = 0x04;
const TAG_OCTET_STRING_CONSTRUCTED = 0x24;
const TAG_EXPLICIT_0 = 0xa0;
const CONSTRUCTED = 0x20;

const OID_SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
const OID_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01];

interface Node {
  tag: number;
  depth: number;
  contentStart: number;
  /** Exclusive end of the content (for an indefinite length: where the end-of-contents marker starts). */
  contentEnd: number;
  /** Exclusive end of the whole element, marker included. */
  end: number;
  kids?: Node[];
}

interface Reader {
  bytes: Uint8Array;
  tlvs: number;
}

function readNode(reader: Reader, pos: number, limit: number, depth: number): Node {
  if (depth > CMS_MAX_DEPTH) return fail("depth");
  reader.tlvs += 1;
  if (reader.tlvs > CMS_MAX_TLVS) return fail("limits");
  const { bytes } = reader;
  if (pos + 2 > limit) return fail("structure");
  const tag = bytes[pos]!;
  if ((tag & 0x1f) === 0x1f) return fail("structure"); // high tag numbers do not occur in CMS
  const first = bytes[pos + 1]!;
  let contentStart = pos + 2;

  if (first === 0x80) {
    // BER indefinite length: constructed types only, closed by an end-of-contents marker.
    if ((tag & CONSTRUCTED) === 0) return fail("structure");
    const kids: Node[] = [];
    let p = contentStart;
    for (;;) {
      if (p + 2 > limit) return fail("structure");
      if (bytes[p] === 0x00 && bytes[p + 1] === 0x00) {
        return { tag, depth, contentStart, contentEnd: p, end: p + 2, kids };
      }
      const kid = readNode(reader, p, limit, depth + 1);
      kids.push(kid);
      p = kid.end;
    }
  }

  let length = first;
  if (first > 0x80) {
    const count = first & 0x7f;
    if (count > CMS_MAX_LENGTH_BYTES) return fail("length");
    if (contentStart + count > limit) return fail("structure");
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[contentStart + i]!;
    contentStart += count;
  }
  if (length > limit - contentStart) return fail("length");
  const contentEnd = contentStart + length;
  return { tag, depth, contentStart, contentEnd, end: contentEnd };
}

/** The children of a constructed node (read once; an indefinite node has them already). */
function kidsOf(reader: Reader, node: Node): Node[] {
  if (node.kids) return node.kids;
  if ((node.tag & CONSTRUCTED) === 0) return fail("structure");
  const kids: Node[] = [];
  let p = node.contentStart;
  while (p < node.contentEnd) {
    const kid = readNode(reader, p, node.contentEnd, node.depth + 1);
    kids.push(kid);
    p = kid.end;
  }
  node.kids = kids;
  return kids;
}

function isOid(reader: Reader, node: Node | undefined, expected: number[]): boolean {
  if (!node || node.tag !== TAG_OID || node.contentEnd - node.contentStart !== expected.length)
    return false;
  return expected.every((b, i) => reader.bytes[node.contentStart + i] === b);
}

/** The bytes of an OCTET STRING, primitive or BER-constructed from chunks. */
function octetsOf(reader: Reader, node: Node, parts: Uint8Array[]): void {
  if (node.tag === TAG_OCTET_STRING) {
    parts.push(reader.bytes.subarray(node.contentStart, node.contentEnd));
    return;
  }
  if (node.tag !== TAG_OCTET_STRING_CONSTRUCTED) return fail("structure");
  for (const kid of kidsOf(reader, node)) octetsOf(reader, kid, parts);
}

function eContentOf(reader: Reader): Uint8Array {
  const { bytes } = reader;
  const root = readNode(reader, 0, bytes.length, 1);
  for (let i = root.end; i < bytes.length; i += 1) {
    // Signing tools sometimes end the file with a line break or padding; anything else is not an envelope.
    if (![0x00, 0x0a, 0x0d, 0x20].includes(bytes[i]!)) return fail("trailing");
  }
  if (root.tag !== TAG_SEQUENCE) return fail("structure");
  const [type, explicit] = kidsOf(reader, root);
  if (!isOid(reader, type, OID_SIGNED_DATA)) return fail("content_type");
  if (!explicit || explicit.tag !== TAG_EXPLICIT_0) return fail("structure");
  const signedData = kidsOf(reader, explicit)[0];
  if (!signedData || signedData.tag !== TAG_SEQUENCE) return fail("structure");
  // version, digestAlgorithms, encapContentInfo; certificates and signerInfos follow and are never read.
  const encap = kidsOf(reader, signedData)[2];
  if (!encap || encap.tag !== TAG_SEQUENCE) return fail("structure");
  const [eContentType, eContent] = kidsOf(reader, encap);
  if (!isOid(reader, eContentType, OID_DATA)) return fail("content_type");
  if (!eContent) return fail("detached");
  if (eContent.tag !== TAG_EXPLICIT_0) return fail("structure");
  const octets = kidsOf(reader, eContent);
  if (octets.length !== 1) return fail("structure");
  const parts: Uint8Array[] = [];
  octetsOf(reader, octets[0]!, parts);
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  if (size > bytes.length) return fail("limits");
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const PEM_BEGIN = "-----BEGIN ";
const PEM_END = "-----END ";

function base64Value(byte: number): boolean {
  return (
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    (byte >= 0x30 && byte <= 0x39) ||
    byte === 0x2b ||
    byte === 0x2f
  );
}

/** base64 text, with or without PEM armour, to bytes. A manual scan: no pattern can backtrack on hostile input. */
function decodeText(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.length;
  let first = 0;
  while (first < bytes.length && WHITESPACE.has(bytes[first]!)) first += 1;
  const armoured =
    first + PEM_BEGIN.length <= bytes.length &&
    Buffer.from(bytes.subarray(first, first + PEM_BEGIN.length)).toString("latin1") === PEM_BEGIN;
  if (armoured) {
    const lineEnd = bytes.indexOf(0x0a, first);
    const endMarker = Buffer.from(bytes).lastIndexOf(PEM_END);
    if (lineEnd < 0 || endMarker < lineEnd) return fail("encoding");
    start = lineEnd + 1;
    end = endMarker;
  }
  const clean = new Uint8Array(end - start);
  let used = 0;
  let padding = 0;
  for (let i = start; i < end; i += 1) {
    const byte = bytes[i]!;
    if (WHITESPACE.has(byte)) continue;
    if (byte === 0x3d && padding < 2) {
      padding += 1;
      clean[used++] = byte;
    } else if (padding === 0 && base64Value(byte)) {
      clean[used++] = byte;
    } else {
      return fail("encoding");
    }
  }
  if (used === 0 || used % 4 !== 0) return fail("encoding");
  return new Uint8Array(
    Buffer.from(Buffer.from(clean.subarray(0, used)).toString("latin1"), "base64"),
  );
}

/**
 * The invoice bytes inside a .p7m (DER or BER, or the same as base64 text or PEM), through up to
 * CMS_MAX_ENVELOPES nested envelopes. Throws FatturaError("p7m_unreadable", reason) and nothing else.
 */
export function unwrapP7m(input: Uint8Array): Uint8Array {
  let bytes = input[0] === TAG_SEQUENCE ? input : decodeText(input);
  for (let level = 1; ; level += 1) {
    bytes = eContentOf({ bytes, tlvs: 0 });
    // A parallel signature wraps the envelope in another one; the plain file is whatever is not.
    if (!hasSignedDataHead(bytes)) return bytes;
    if (level >= CMS_MAX_ENVELOPES) return fail("nesting");
  }
}
