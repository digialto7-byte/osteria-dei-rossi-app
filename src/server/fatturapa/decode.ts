/**
 * From the bytes of an XML file to its text. UTF-8 (strict) and the two Latin-1 labels are read;
 * every other encoding is refused, and so is a document type declaration: a FatturaPA file never
 * has one, and refusing it here means no parser ever sees an entity definition.
 */
import { XML_MAX_BYTES } from "@/server/fatturapa/constants";
import { FatturaError } from "@/server/fatturapa/errors";

const refuse = (reason: string): never => {
  throw new FatturaError("xml_unreadable", reason);
};

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const DECLARATION = /^<\?xml\s+([^?]*)\?>/;
const ENCODING = /\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const VERSION = /\bversion\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const DTD = /<!(?:doctype|entity)/i;
const DECLARATION_WINDOW = 256;

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes.length > XML_MAX_BYTES) return refuse("limits");
  // UTF-16 and UTF-32, with or without a byte order mark (a NUL among the first bytes of an XML file).
  if (
    startsWith(bytes, [0xff, 0xfe]) ||
    startsWith(bytes, [0xfe, 0xff]) ||
    startsWith(bytes, [0x00, 0x00, 0xfe, 0xff])
  ) {
    return refuse("encoding");
  }
  if (bytes.subarray(0, 4).includes(0x00)) return refuse("encoding");

  const start = startsWith(bytes, UTF8_BOM) ? UTF8_BOM.length : 0;
  const head = Buffer.from(bytes.subarray(start, start + DECLARATION_WINDOW)).toString("latin1");
  const declaration = DECLARATION.exec(head)?.[1] ?? "";
  const label = ENCODING.exec(declaration);
  const encoding = (label?.[1] ?? label?.[2] ?? "utf-8").toLowerCase();
  const version = VERSION.exec(declaration);
  if (version && (version[1] ?? version[2]) !== "1.0") return refuse("version");

  let text: string;
  if (encoding === "utf-8") {
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(start),
      );
    } catch {
      return refuse("encoding");
    }
  } else if (encoding === "iso-8859-1" || encoding === "windows-1252") {
    // A UTF-8 mark says UTF-8, the declaration says Latin-1: the file contradicts itself, so it is not guessed.
    if (start > 0) return refuse("bom_encoding_mismatch");
    text = new TextDecoder("windows-1252", { ignoreBOM: true }).decode(bytes);
  } else {
    return refuse("encoding");
  }
  if (DTD.test(text)) return refuse("dtd");
  return text;
}
