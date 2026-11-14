/**
 * The one file that touches the XML library (saxes: strict, streaming, no DTD processing, only the
 * five predefined entities). It turns the text of a FatturaPA file into a small element tree and
 * enforces the limits while it reads, so a hostile file stops early.
 *
 * - No I/O of any kind: nothing is fetched or opened, XInclude elements are ordinary unknown elements.
 * - Elements are matched by local name. A child in no namespace, or in the root's namespace, keeps
 *   its local name; a child in another namespace is named "<uri>|<local>" and never matches. The
 *   XMLDSig subtree (a XAdES signature) is skipped, and so is everything inside Allegati: both are
 *   counted against the limits but never kept.
 * - The tree holds names as values in arrays, never as object keys, so no element name can reach a
 *   prototype.
 * - Errors carry a code and a reason key only: the library's messages quote the file.
 */
import { SaxesParser, type SaxesTagNS } from "saxes";
import {
  NS_FATTURA,
  NS_FATTURA_SEMPLIFICATA,
  NS_XMLDSIG,
  XML_FORMATS,
  XML_MAX_ATTRIBUTES,
  XML_MAX_DEPTH,
  XML_MAX_ELEMENTS,
  XML_MAX_TEXT_CHARS,
} from "@/server/fatturapa/constants";
import { decodeXmlBytes } from "@/server/fatturapa/decode";
import { FatturaError } from "@/server/fatturapa/errors";

export interface XmlNode {
  /** The local name (or "<uri>|<local>" for a foreign namespace). */
  name: string;
  /** The text directly inside the element (white space between elements is dropped). */
  text: string;
  kids: XmlNode[];
}

export interface XmlDocument {
  root: XmlNode;
  versione: (typeof XML_FORMATS)[number];
  /** How many Allegati elements the file holds (their content is not kept). */
  attachments: number;
}

const refuse = (code: FatturaError["code"], reason: string): never => {
  throw new FatturaError(code, reason);
};

const NON_WHITESPACE = /\S/;

interface Frame {
  node: XmlNode | null; // null: inside a skipped subtree
  chars: number;
  counted: boolean; // text counts against the node limit
  skipKids: boolean; // Allegati: the element is kept, its content is not
}

/** Reads the text of a FatturaPA file (see decodeXmlBytes) into a tree. */
export function parseFatturaXml(text: string): XmlDocument {
  const parser = new SaxesParser({ xmlns: true, position: false });
  const stack: Frame[] = [];
  let root: XmlNode | null = null;
  let versione: XmlDocument["versione"] | null = null;
  let rootUri = "";
  let elements = 0;
  let attributes = 0;
  let attachments = 0;

  parser.on("error", () => refuse("xml_unreadable", "malformed"));
  parser.on("doctype", () => refuse("xml_unreadable", "dtd"));
  parser.on("opentagstart", () => {
    attributes = 0;
  });
  parser.on("attribute", (attribute) => {
    attributes += 1;
    if (attributes > XML_MAX_ATTRIBUTES || attribute.value.length > XML_MAX_TEXT_CHARS)
      refuse("xml_unreadable", "limits");
  });

  parser.on("opentag", (tag: SaxesTagNS) => {
    elements += 1;
    if (elements > XML_MAX_ELEMENTS || stack.length >= XML_MAX_DEPTH)
      refuse("xml_unreadable", "limits");
    const parent = stack[stack.length - 1];

    if (!root && stack.length === 0) {
      if (tag.uri === NS_FATTURA_SEMPLIFICATA && tag.local === "FatturaElettronicaSemplificata") {
        refuse("xml_simplified_unsupported", "simplified");
      }
      const declared = tag.attributes["versione"]?.value;
      const format = XML_FORMATS.find((candidate) => candidate === declared);
      if (tag.uri !== NS_FATTURA || tag.local !== "FatturaElettronica" || !format)
        refuse("xml_not_fatturapa", "root");
      versione = format!;
      rootUri = tag.uri;
    }

    const skipped = !!parent && (parent.node === null || parent.skipKids);
    const isAllegati = tag.local === "Allegati" && (tag.uri === "" || tag.uri === rootUri);
    if (isAllegati) attachments += 1;

    // Inside a skipped subtree nothing is kept; a signature is dropped whole; Allegati is kept empty.
    if (skipped || tag.uri === NS_XMLDSIG) {
      stack.push({ node: null, chars: 0, counted: false, skipKids: false });
      return;
    }
    const name = tag.uri === "" || tag.uri === rootUri ? tag.local : `${tag.uri}|${tag.local}`;
    const node: XmlNode = { name, text: "", kids: [] };
    if (parent) parent.node!.kids.push(node);
    else root = node;
    stack.push({ node, chars: 0, counted: !isAllegati, skipKids: isAllegati });
  });

  parser.on("closetag", () => {
    stack.pop();
  });

  const onText = (chunk: string) => {
    const frame = stack[stack.length - 1];
    if (!frame || !frame.node || !frame.counted) return;
    if (!NON_WHITESPACE.test(chunk)) return;
    frame.chars += chunk.length;
    if (frame.chars > XML_MAX_TEXT_CHARS) refuse("xml_unreadable", "limits");
    frame.node.text += chunk;
  };
  parser.on("text", onText);
  parser.on("cdata", onText);

  parser.write(text).close();
  if (!root || !versione) return refuse("xml_not_fatturapa", "root");
  return { root, versione, attachments };
}

/** Bytes of an XML file (or of the XML inside a p7m) to the tree. */
export function readFatturaXml(bytes: Uint8Array): XmlDocument {
  return parseFatturaXml(decodeXmlBytes(bytes));
}

/** The first direct child with this name, if any. */
export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.kids.find((kid) => kid.name === name);
}

/** Every direct child with this name, in document order. */
export function children(node: XmlNode, name: string): XmlNode[] {
  return node.kids.filter((kid) => kid.name === name);
}

/** The trimmed text of the first direct child with this name, or undefined when absent or empty. */
export function textOf(node: XmlNode | undefined, name: string): string | undefined {
  const found = node ? child(node, name) : undefined;
  const value = found?.text.trim();
  return value ? value : undefined;
}
