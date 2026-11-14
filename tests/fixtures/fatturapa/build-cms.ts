// Test-only builder of CMS (RFC 5652) envelopes as DER and BER bytes. Only the structure the unwrap
// walks is real: certificates and signer infos are opaque filler, and nothing is signed.

export const OID_SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
export const OID_ENVELOPED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x03];
export const OID_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01];

export type Bytes = number[];

export function derLength(length: number): Bytes {
  if (length < 0x80) return [length];
  const bytes: Bytes = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return [0x80 | bytes.length, ...bytes];
}

/** A definite-length TLV. */
export function tlv(tag: number, content: Bytes | Uint8Array): Bytes {
  const body = Array.from(content);
  return [tag, ...derLength(body.length), ...body];
}

/** A BER constructed TLV with indefinite length (ends with 00 00). */
export function indefinite(tag: number, content: Bytes | Uint8Array): Bytes {
  return [tag, 0x80, ...Array.from(content), 0x00, 0x00];
}

export const oid = (content: Bytes): Bytes => tlv(0x06, content);
export const octetString = (content: Bytes | Uint8Array): Bytes => tlv(0x04, content);
export const sequence = (...parts: Bytes[]): Bytes => tlv(0x30, parts.flat());

export interface SignedDataOptions {
  content?: Uint8Array | null;
  /** BER: indefinite lengths everywhere and the content as chunks of this size. */
  ber?: { chunk: number };
  contentInfoOid?: Bytes;
  eContentType?: Bytes;
  /** Opaque filler for the certificates [0] and the signer infos. */
  certificates?: Bytes;
  signature?: Bytes;
}

/** A CMS ContentInfo wrapping SignedData that holds `content` (null: a detached signature). */
export function buildSignedData(options: SignedDataOptions = {}): Uint8Array {
  const {
    content = new TextEncoder().encode("<a/>"),
    ber,
    contentInfoOid = OID_SIGNED_DATA,
    eContentType = OID_DATA,
    certificates = [0x30, 0x03, 0x02, 0x01, 0x07],
    signature = [0xde, 0xad, 0xbe, 0xef],
  } = options;
  const wrapEncap = (children: Bytes): Bytes =>
    ber ? indefinite(0x30, children) : sequence(children);
  const wrapExplicit = (children: Bytes): Bytes =>
    ber ? indefinite(0xa0, children) : tlv(0xa0, children);
  let eContent: Bytes = [];
  if (content) {
    if (ber) {
      const chunks: Bytes[] = [];
      for (let i = 0; i < content.length; i += ber.chunk)
        chunks.push(octetString(content.subarray(i, i + ber.chunk)));
      eContent = wrapExplicit(indefinite(0x24, chunks.flat()));
    } else {
      eContent = wrapExplicit(octetString(content));
    }
  }
  const encap = wrapEncap([...oid(eContentType), ...eContent]);
  const signerInfos = tlv(0x31, sequence([0x02, 0x01, 0x01], tlv(0x04, signature)));
  const signedDataBody: Bytes = [
    ...tlv(0x02, [0x01]),
    ...tlv(0x31, sequence(oid([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]))),
    ...encap,
    ...tlv(0xa0, certificates),
    ...signerInfos,
  ];
  const signedData = ber ? indefinite(0x30, signedDataBody) : sequence(signedDataBody);
  const inner = wrapExplicit(signedData);
  const info = [...oid(contentInfoOid), ...inner];
  return Uint8Array.from(ber ? indefinite(0x30, info) : sequence(info));
}

export function toBase64Lines(bytes: Uint8Array, width = 64): string {
  const text = Buffer.from(bytes).toString("base64");
  return (text.match(new RegExp(`.{1,${width}}`, "g")) ?? []).join("\r\n");
}

export function toPem(bytes: Uint8Array): string {
  return `-----BEGIN PKCS7-----\n${toBase64Lines(bytes)}\n-----END PKCS7-----\n`;
}

/** n levels of indefinite-length SEQUENCE, the innermost empty: a hostile depth probe. */
export function deepIndefinite(levels: number): Uint8Array {
  let inner: Bytes = [0x30, 0x80, 0x00, 0x00];
  for (let i = 1; i < levels; i += 1) inner = indefinite(0x30, inner);
  return Uint8Array.from(inner);
}

/** A tiny seeded generator (mulberry32) so a fuzz failure can be replayed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
