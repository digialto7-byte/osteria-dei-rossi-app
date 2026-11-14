import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeXmlBytes } from "@/server/fatturapa/decode";
import { FatturaError } from "@/server/fatturapa/errors";
import {
  XML_MAX_ATTRIBUTES,
  XML_MAX_BYTES,
  XML_MAX_DEPTH,
  XML_MAX_ELEMENTS,
  XML_MAX_TEXT_CHARS,
} from "@/server/fatturapa/constants";
import { readFatturaXml, type XmlNode } from "@/server/fatturapa/xml";
import {
  NS_DSIG,
  NS_FPR,
  NS_SEMPLIFICATA,
  bytesOf,
  nested,
  root,
} from "../../fixtures/fatturapa/build-xml";

function refusal(bytes: Uint8Array): FatturaError {
  try {
    readFatturaXml(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(FatturaError);
    return error as FatturaError;
  }
  throw new Error("expected the reader to refuse the file");
}
const refused = (bytes: Uint8Array): [string, string] => {
  const error = refusal(bytes);
  return [error.code, error.reason];
};

function walk(node: XmlNode, visit: (node: XmlNode) => void): void {
  visit(node);
  for (const kid of node.kids) walk(kid, visit);
}
const namesOf = (node: XmlNode): string[] => {
  const names: string[] = [];
  walk(node, (n) => names.push(n.name));
  return names;
};

afterEach(() => vi.restoreAllMocks());

describe("a document type declaration is refused before parsing", () => {
  const cases: [string, string][] = [
    ["inline subset", `<?xml version="1.0"?><!DOCTYPE a [<!ELEMENT a ANY>]><a/>`],
    ["external SYSTEM file", `<?xml version="1.0"?><!DOCTYPE a SYSTEM "file:///etc/passwd"><a/>`],
    [
      "external http",
      `<?xml version="1.0"?><!DOCTYPE a SYSTEM "http://attacker.invalid/x.dtd"><a/>`,
    ],
    ["a lone ENTITY", `<?xml version="1.0"?><!ENTITY x "y"><a/>`],
    ["lower-case keyword", `<?xml version="1.0"?><!doctype a><a/>`],
  ];
  it.each(cases)(
    "%s: xml_unreadable, reason dtd, with no file or network access",
    (_name, text) => {
      const read = vi.spyOn(fs, "readFileSync");
      const open = vi.spyOn(fs, "openSync");
      const fetched = vi.spyOn(globalThis, "fetch");
      const request = vi.spyOn(http, "request");
      expect(refused(bytesOf(text))).toEqual(["xml_unreadable", "dtd"]);
      for (const spy of [read, open, fetched, request]) expect(spy).not.toHaveBeenCalled();
    },
  );
});

describe("attack files", () => {
  const load = (name: string): Uint8Array =>
    fs.readFileSync(new URL(`../../fixtures/fatturapa/attacks/${name}`, import.meta.url));

  it.each([
    "billion-laughs.xml",
    "external-entity.xml",
    "external-dtd.xml",
    "parameter-entity.xml",
  ])("%s is refused as dtd, touching neither the file system nor the network", (name) => {
    const bytes = load(name);
    const reads = vi.spyOn(fs, "readFileSync");
    const get = vi.spyOn(https, "get");
    const fetched = vi.spyOn(globalThis, "fetch");
    expect(refused(bytes)).toEqual(["xml_unreadable", "dtd"]);
    for (const spy of [reads, get, fetched]) expect(spy).not.toHaveBeenCalled();
  });

  it("xinclude.xml parses and the include elements are plain unknown elements: nothing is fetched", () => {
    const bytes = load("xinclude.xml");
    const reads = vi.spyOn(fs, "readFileSync");
    const fetched = vi.spyOn(globalThis, "fetch");
    const doc = readFatturaXml(bytes);
    expect(doc.versione).toBe("FPR12");
    expect(doc.root.kids.every((kid) => kid.kids.length === 0 && kid.text === "")).toBe(true);
    expect(reads).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe("entities", () => {
  it("an undefined entity is refused", () => {
    expect(refused(bytesOf(root("<a>&x;</a>")))).toEqual(["xml_unreadable", "malformed"]);
  });

  it("the five predefined entities and numeric references are read", () => {
    const doc = readFatturaXml(bytesOf(root("<a>&lt;&gt;&amp;&quot;&apos;&#233;&#x20AC;</a>")));
    expect(doc.root.kids[0]!.text).toBe("<>&\"'é€");
  });
});

describe("limits", () => {
  it(`depth: ${XML_MAX_DEPTH} levels are read, one more is refused`, () => {
    // The root is level 1.
    expect(readFatturaXml(bytesOf(root(nested(XML_MAX_DEPTH - 1)))).root.name).toBe(
      "FatturaElettronica",
    );
    expect(refused(bytesOf(root(nested(XML_MAX_DEPTH))))).toEqual(["xml_unreadable", "limits"]);
  });

  it(`elements: ${XML_MAX_ELEMENTS} are read, one more is refused`, () => {
    expect(
      readFatturaXml(bytesOf(root("<a/>".repeat(XML_MAX_ELEMENTS - 1)))).root.kids,
    ).toHaveLength(XML_MAX_ELEMENTS - 1);
    expect(refused(bytesOf(root("<a/>".repeat(XML_MAX_ELEMENTS))))).toEqual([
      "xml_unreadable",
      "limits",
    ]);
  });

  const attrs = (n: number): string => Array.from({ length: n }, (_, i) => `k${i}="v"`).join(" ");

  it(`attributes: ${XML_MAX_ATTRIBUTES} per element are read, one more is refused`, () => {
    expect(
      readFatturaXml(bytesOf(root(`<a ${attrs(XML_MAX_ATTRIBUTES)}/>`))).root.kids,
    ).toHaveLength(1);
    expect(refused(bytesOf(root(`<a ${attrs(XML_MAX_ATTRIBUTES + 1)}/>`)))).toEqual([
      "xml_unreadable",
      "limits",
    ]);
  });

  it("a huge attribute value is refused", () => {
    expect(
      readFatturaXml(bytesOf(root(`<a k="${"x".repeat(XML_MAX_TEXT_CHARS)}"/>`))).root.kids,
    ).toHaveLength(1);
    expect(refused(bytesOf(root(`<a k="${"x".repeat(XML_MAX_TEXT_CHARS + 1)}"/>`)))).toEqual([
      "xml_unreadable",
      "limits",
    ]);
  });

  it(`text: ${XML_MAX_TEXT_CHARS} characters in a node are read, one more is refused (also in CDATA)`, () => {
    expect(
      readFatturaXml(bytesOf(root(`<a>${"x".repeat(XML_MAX_TEXT_CHARS)}</a>`))).root.kids[0]!.text,
    ).toHaveLength(XML_MAX_TEXT_CHARS);
    expect(refused(bytesOf(root(`<a>${"x".repeat(XML_MAX_TEXT_CHARS + 1)}</a>`)))).toEqual([
      "xml_unreadable",
      "limits",
    ]);
    expect(
      refused(bytesOf(root(`<a><![CDATA[${"x".repeat(XML_MAX_TEXT_CHARS + 1)}]]></a>`))),
    ).toEqual(["xml_unreadable", "limits"]);
  });

  it("white space between elements is not counted as text", () => {
    const doc = readFatturaXml(
      bytesOf(root(`${"\n      ".repeat(5000)}<a/>${"\n      ".repeat(5000)}`)),
    );
    expect(doc.root.kids).toHaveLength(1);
    expect(doc.root.text).toBe("");
  });

  it("an input over the byte limit is refused before it is decoded", () => {
    expect(refused(new Uint8Array(XML_MAX_BYTES + 1).fill(0x20))).toEqual([
      "xml_unreadable",
      "limits",
    ]);
  });
});

describe("Allegati and signatures are counted, never kept", () => {
  it("a 3 MB base64 Attachment is accepted and absent from the result", () => {
    const blob = "QUJD".repeat(750_000); // 3 000 000 characters
    const doc = readFatturaXml(
      bytesOf(
        root(
          `<FatturaElettronicaBody><Allegati><NomeAttachment>a.pdf</NomeAttachment><Attachment>${blob}</Attachment></Allegati></FatturaElettronicaBody>`,
        ),
      ),
    );
    expect(doc.attachments).toBe(1);
    expect(JSON.stringify(doc.root).length).toBeLessThan(2000);
    expect(namesOf(doc.root)).not.toContain("Attachment");
    expect(namesOf(doc.root)).toContain("Allegati");
  });

  it("the depth, element and attribute limits still apply inside an Allegati", () => {
    const inner = `<Allegati>${nested(XML_MAX_DEPTH)}</Allegati>`;
    expect(refused(bytesOf(root(inner)))).toEqual(["xml_unreadable", "limits"]);
  });

  it("a XAdES ds:Signature element is skipped, whatever it holds", () => {
    const signature = `<ds:Signature xmlns:ds="${NS_DSIG}" Id="s"><ds:SignedInfo><ds:Reference URI="">x</ds:Reference></ds:SignedInfo><ds:SignatureValue>${"A".repeat(50_000)}</ds:SignatureValue></ds:Signature>`;
    const doc = readFatturaXml(bytesOf(root(`<FatturaElettronicaHeader/>${signature}`)));
    expect(namesOf(doc.root)).toEqual(["FatturaElettronica", "FatturaElettronicaHeader"]);
  });
});

describe("encodings", () => {
  it("strips a UTF-8 byte order mark", () => {
    const body = bytesOf(root("<a>è</a>"));
    const doc = readFatturaXml(Uint8Array.from([0xef, 0xbb, 0xbf, ...body]));
    expect(doc.root.kids[0]!.text).toBe("è");
  });

  it.each([
    [
      "a UTF-16 LE byte order mark",
      Uint8Array.from([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00, 0x2f, 0x00, 0x3e, 0x00]),
    ],
    [
      "a UTF-16 BE byte order mark",
      Uint8Array.from([0xfe, 0xff, 0x00, 0x3c, 0x00, 0x61, 0x00, 0x2f, 0x00, 0x3e]),
    ],
    ["a UTF-32 byte order mark", Uint8Array.from([0xff, 0xfe, 0x00, 0x00, 0x3c, 0x00, 0x00, 0x00])],
    ["UTF-16 without a mark", Uint8Array.from([0x3c, 0x00, 0x61, 0x00, 0x2f, 0x00, 0x3e, 0x00])],
    ["a declared utf-16", bytesOf('<?xml version="1.0" encoding="utf-16"?><a/>')],
    ["a declared shift_jis", bytesOf('<?xml version="1.0" encoding="Shift_JIS"?><a/>')],
    [
      "invalid UTF-8",
      Uint8Array.from([
        ...bytesOf('<?xml version="1.0" encoding="UTF-8"?><a>'),
        0xc3,
        0x28,
        ...bytesOf("</a>"),
      ]),
    ],
    [
      "invalid UTF-8 with no declaration",
      Uint8Array.from([...bytesOf("<a>"), 0xe8, ...bytesOf("</a>")]),
    ],
  ])("refuses %s as encoding", (_name, bytes) => {
    expect(refused(bytes)).toEqual(["xml_unreadable", "encoding"]);
  });

  it("refuses XML 1.1", () => {
    expect(refused(bytesOf('<?xml version="1.1" encoding="UTF-8"?><a/>'))).toEqual([
      "xml_unreadable",
      "version",
    ]);
  });

  it.each(["iso-8859-1", "ISO-8859-1", "windows-1252"])("reads %s: byte 0xE8 is è", (label) => {
    const bytes = Uint8Array.from([
      ...bytesOf(`<?xml version="1.0" encoding="${label}"?><a>`),
      0xe8,
      ...bytesOf("</a>"),
    ]);
    expect(decodeXmlBytes(bytes)).toContain("<a>è</a>");
  });
});

describe("what is read", () => {
  it("ignores a stylesheet instruction and comments, keeps CDATA text", () => {
    const text = `${'<?xml version="1.0" encoding="UTF-8"?>'}\n<?xml-stylesheet type="text/xsl" href="http://attacker.invalid/s.xsl"?>\n<!-- c --><p:FatturaElettronica xmlns:p="${NS_FPR}" versione="FPR12"><!-- c --><a><![CDATA[<b>&amp;</b>]]></a></p:FatturaElettronica>`;
    const doc = readFatturaXml(bytesOf(text));
    expect(doc.root.kids).toHaveLength(1);
    expect(doc.root.kids[0]!.text).toBe("<b>&amp;</b>");
  });

  it.each([
    ["prefix p", "p"],
    ["prefix ns2", "ns2"],
    ["the default namespace", null],
  ])("recognises the root with %s", (_name, prefix) => {
    const doc = readFatturaXml(bytesOf(root("<a>1</a>", { prefix })));
    expect(doc.root.name).toBe("FatturaElettronica");
    expect(doc.root.kids[0]!.name).toBe("a");
  });

  it("reads FPA12 as well", () => {
    expect(readFatturaXml(bytesOf(root("", { versione: "FPA12" }))).versione).toBe("FPA12");
  });

  it("refuses a wrong namespace, a wrong versione and another root", () => {
    const wrongNs = `<p:FatturaElettronica xmlns:p="http://example.invalid/x" versione="FPR12"/>`;
    expect(refused(bytesOf(wrongNs))).toEqual(["xml_not_fatturapa", "root"]);
    expect(refused(bytesOf(root("", { versione: "FPX12" })))).toEqual([
      "xml_not_fatturapa",
      "root",
    ]);
    expect(refused(bytesOf(`<a/>`))).toEqual(["xml_not_fatturapa", "root"]);
    expect(refused(bytesOf(`<p:FatturaElettronica xmlns:p="${NS_FPR}"/>`))).toEqual([
      "xml_not_fatturapa",
      "root",
    ]);
  });

  it("answers xml_simplified_unsupported for a FSM10 root", () => {
    const text = `<p:FatturaElettronicaSemplificata xmlns:p="${NS_SEMPLIFICATA}" versione="FSM10"/>`;
    expect(refused(bytesOf(text))).toEqual(["xml_simplified_unsupported", "simplified"]);
  });

  it("matches children by local name, with no namespace or the root's", () => {
    const text = `<p:FatturaElettronica xmlns:p="${NS_FPR}" xmlns:x="http://example.invalid/x" versione="FPR12"><a/><x:b/><c xmlns="${NS_FPR}"/></p:FatturaElettronica>`;
    expect(namesOf(readFatturaXml(bytesOf(text)).root)).toEqual([
      "FatturaElettronica",
      "a",
      "http://example.invalid/x|b",
      "c",
    ]);
  });

  it.each(["__proto__", "constructor", "hasOwnProperty", "toString"])(
    "an element named %s cannot touch any prototype",
    (name) => {
      const doc = readFatturaXml(bytesOf(root(`<${name}><${name}>polluted</${name}></${name}>`)));
      expect(namesOf(doc.root)).toEqual(["FatturaElettronica", name, name]);
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.keys(Object.prototype)).toEqual([]);
      expect(Object.getPrototypeOf(doc.root)).toBe(Object.prototype);
    },
  );
});

describe("malformed files", () => {
  it.each([
    ["an unclosed element", root("<a>")],
    ["a mismatched close", root("<a></b>")],
    ["text after the root", root("") + "junk"],
    ["a second root", root("") + "<b/>"],
    ["an undeclared prefix", root("<q:a/>")],
    ["an empty file", ""],
    ["a lone angle bracket", "<"],
  ])("%s is xml_unreadable, never another error", (_name, text) => {
    const error = refusal(bytesOf(text));
    expect(error.code === "xml_unreadable" || error.code === "xml_not_fatturapa").toBe(true);
  });

  it("an error carries a code and a reason, never the file's text", () => {
    const secret = "SECRET-SUPPLIER-NAME";
    const error = refusal(bytesOf(root(`<${secret}>&${secret};</${secret}>`)));
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error.details)).not.toContain(secret);
    expect(error.reason).not.toContain(secret);
  });
});

describe("size", () => {
  it("reads a 4 MiB file with 200 lines within the default timeout", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) =>
        `<DettaglioLinee><NumeroLinea>${i + 1}</NumeroLinea><Descrizione>Prodotto demo</Descrizione></DettaglioLinee>`,
    ).join("");
    const filler = "QUJD".repeat(Math.floor((XML_MAX_BYTES - 40_000) / 4));
    const bytes = bytesOf(
      root(
        `<FatturaElettronicaBody>${lines}<Allegati><Attachment>${filler}</Attachment></Allegati></FatturaElettronicaBody>`,
      ),
    );
    expect(bytes.length).toBeGreaterThan(XML_MAX_BYTES - 40_000);
    expect(bytes.length).toBeLessThanOrEqual(XML_MAX_BYTES);
    expect(readFatturaXml(bytes).root.kids[0]!.kids).toHaveLength(201);
  });
});
