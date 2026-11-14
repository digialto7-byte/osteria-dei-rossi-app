import { describe, expect, it } from "vitest";
import { XML_MAX_BODIES, XML_MAX_DETAILS, XML_MAX_LINES } from "@/server/fatturapa/constants";
import { FatturaError, type FatturaErrorDetail } from "@/server/fatturapa/errors";
import {
  DOCUMENT_TYPE_LABELS,
  documentTypeLabel,
  UNKNOWN_DOCUMENT_TYPE_LABEL,
  natureLabel,
} from "@/server/fatturapa/labels";
import { mapFattura, type MappedFile } from "@/server/fatturapa/map";
import { Reasons, documentTypeOf, findUnsupportedContent } from "@/server/fatturapa/rules";
import { children, readFatturaXml } from "@/server/fatturapa/xml";
import { bytesOf, fileXml, type BodySpec, type FileSpec } from "../../fixtures/fatturapa/build-xml";

function run(spec: FileSpec | string): unknown {
  const text = typeof spec === "string" ? spec : fileXml(spec);
  return mapFattura(readFatturaXml(bytesOf(text)));
}

function refusal(spec: FileSpec | string): FatturaError {
  try {
    run(spec);
  } catch (error) {
    expect(error).toBeInstanceOf(FatturaError);
    return error as FatturaError;
  }
  throw new Error("expected a refusal");
}

const one = (body: BodySpec): FileSpec => ({ bodies: [body] });
const refused = (spec: FileSpec | string): [string, string] => {
  const error = refusal(spec);
  return [error.code, error.reason];
};

const ACCEPTED = ["TD01", "TD24", "TD25"];
const REFUSED = [
  "TD02",
  "TD03",
  "TD04",
  "TD05",
  "TD06",
  "TD07",
  "TD08",
  "TD09",
  ...Array.from({ length: 8 }, (_, i) => `TD${16 + i}`),
  "TD26",
  "TD27",
  "TD28",
  "TD29",
];

describe("document types: an explicit allow-list (TD01, TD24, TD25)", () => {
  it.each(ACCEPTED)("%s is accepted and kept", (td) => {
    expect(
      (run(one({ td })) as { bodies: { documentType: string }[] }).bodies[0]!.documentType,
    ).toBe(td);
  });

  it.each(REFUSED)("%s is refused with its code and label", (td) => {
    const error = refusal(one({ td }));
    expect(error.code).toBe("xml_document_type_unsupported");
    expect(error.details).toEqual([{ body: 1, code: td, label: DOCUMENT_TYPE_LABELS[td] }]);
  });

  it("refuses a code nobody knows, naming it as unknown", () => {
    expect(refusal(one({ td: "TD99" })).details).toEqual([
      { body: 1, code: "TD99", label: UNKNOWN_DOCUMENT_TYPE_LABEL },
    ]);
  });

  it.each(["Mario Rossi RSSMRA80A01H501U", "td04", "TD4", "constructor", "x".repeat(5000)])(
    "a type that is not a TDnn code is refused without echoing it (case %#)",
    (td) => {
      const error = refusal(one({ td }));
      expect(error.code).toBe("xml_document_type_unsupported");
      expect(error.details).toEqual([{ body: 1, label: UNKNOWN_DOCUMENT_TYPE_LABEL }]);
      expect(JSON.stringify(error.details)).not.toContain(td.slice(0, 20));
    },
  );

  it("labels are looked up on their own keys, never on the prototype", () => {
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(documentTypeLabel(key)).toBe(UNKNOWN_DOCUMENT_TYPE_LABEL);
      expect(natureLabel(key)).toBe(key);
    }
  });

  it("the credit note label is the one the screen names", () => {
    expect(DOCUMENT_TYPE_LABELS["TD04"]).toBe("Nota di credito");
  });

  it("is checked before anything else in the body, and names the body", () => {
    const error = refusal({ bodies: [{}, { td: "TD04", numero: null, lines: [], summary: [] }] });
    expect(error.details).toEqual([{ body: 2, code: "TD04", label: "Nota di credito" }]);
  });

  it(`lists at most ${XML_MAX_DETAILS} bodies`, () => {
    expect(
      refusal({ bodies: Array.from({ length: 7 }, () => ({ td: "TD04" })) }).details,
    ).toHaveLength(XML_MAX_DETAILS);
  });
});

describe("content that is not handled", () => {
  const reason = (spec: FileSpec | string): string => refusal(spec).reason;
  const details = (spec: FileSpec | string): readonly FatturaErrorDetail[] => refusal(spec).details;

  it("a currency other than EUR", () => {
    expect(refused(one({ divisa: "USD" }))).toEqual(["xml_content_unsupported", "currency"]);
  });

  it("withholding, a pension fund and a line withholding flag", () => {
    expect(
      refused(
        one({
          docExtra:
            "<DatiRitenuta><TipoRitenuta>RT01</TipoRitenuta><ImportoRitenuta>1.00</ImportoRitenuta><AliquotaRitenuta>20.00</AliquotaRitenuta><CausalePagamento>A</CausalePagamento></DatiRitenuta>",
        }),
      ),
    ).toEqual(["xml_content_unsupported", "withholding"]);
    expect(
      reason(
        one({
          docExtra: "<DatiCassaPrevidenziale><TipoCassa>TC01</TipoCassa></DatiCassaPrevidenziale>",
        }),
      ),
    ).toBe("withholding");
    const flagged = details(one({ lines: [{}, { ritenuta: "SI" }] }));
    expect(flagged).toEqual([{ body: 1, line: 2, reason: "withholding" }]);
  });

  it("split payment", () => {
    expect(
      refused(
        one({ summary: [{ rate: "22.00", imponibile: "10.00", imposta: "2.20", esig: "S" }] }),
      ),
    ).toEqual(["xml_content_unsupported", "split_payment"]);
  });

  describe("the DatiBeniServizi wrapper", () => {
    const unwrap = (spec: FileSpec): string =>
      fileXml(spec).replace("<DatiBeniServizi>", "").replace("</DatiBeniServizi>", "");
    const SPLIT = { rate: "22.00", imponibile: "10.00", imposta: "2.20", esig: "S" };

    it("a body without it is refused as invalid content", () => {
      expect(refused(unwrap(one({})))).toEqual(["xml_invalid_content", "invalid"]);
      expect(details(unwrap(one({})))).toEqual([{ body: 1, field: "DatiBeniServizi" }]);
    });

    it("a split payment and a line withholding are refused when the wrapper is there", () => {
      expect(refused(one({ summary: [SPLIT] }))).toEqual([
        "xml_content_unsupported",
        "split_payment",
      ]);
      expect(details(one({ lines: [{ ritenuta: "SI" }] }))).toEqual([
        { body: 1, line: 1, reason: "withholding" },
      ]);
    });

    it("and they are never imported when the wrapper is missing", () => {
      expect(refused(unwrap(one({ summary: [SPLIT] }))).at(0)).toBe("xml_invalid_content");
      expect(refused(unwrap(one({ lines: [{ ritenuta: "SI" }] }))).at(0)).toBe(
        "xml_invalid_content",
      );
    });

    it("a chargeability that is not I or D is refused, never turned into nothing", () => {
      for (const esig of ["X", "i", "SI"]) {
        const error = refusal(
          one({ summary: [{ rate: "22.00", imponibile: "10.00", imposta: "2.20", esig }] }),
        );
        expect(error.code).toBe("xml_invalid_content");
        expect(error.details).toEqual([{ body: 1, field: "DatiRiepilogo.EsigibilitaIVA" }]);
      }
    });
  });

  it("an Arrotondamento or SpeseAccessorie beyond the stored precision is a 422 reason, not a bug", () => {
    const row = (extra: object) => ({
      rate: "22.00",
      imponibile: "10.00",
      imposta: "2.20",
      ...extra,
    });
    for (const extra of [
      { arrot: "100000000.00" },
      { arrot: "-100000000.00" },
      { arrot: "99999999.99999" },
      { spese: "100000000.00" },
    ]) {
      expect(refused(one({ summary: [row(extra)] }))).toEqual([
        "xml_content_unsupported",
        "amount_out_of_range",
      ]);
    }
    expect(() =>
      run(one({ summary: [row({ arrot: "-99999999.9999", spese: "99999999.99" })] })),
    ).not.toThrow();
  });

  it("a quantity that rounds up to the limit is refused with its line", () => {
    expect(
      details(one({ lines: [{ qty: "99999999.99999", unitPrice: "0.00", total: "0.00" }] })),
    ).toEqual([{ body: 1, line: 1, reason: "amount_out_of_range" }]);
  });

  it("a negative line amount, with the line number, and a negative list price", () => {
    expect(details(one({ lines: [{}, { total: "-5.00" }] }))).toEqual([
      { body: 1, line: 2, reason: "negative_line" },
    ]);
    expect(reason(one({ lines: [{ unitPrice: "-5.00" }] }))).toBe("negative_line");
  });

  it("a negative document total, and a negative summary amount", () => {
    expect(refused(one({ totale: "-12.20" }))).toEqual([
      "xml_content_unsupported",
      "negative_total",
    ]);
    expect(
      reason(one({ summary: [{ rate: "22.00", imponibile: "-10.00", imposta: "-2.20" }] })),
    ).toBe("negative_total");
  });

  it(`more than ${XML_MAX_LINES} lines`, () => {
    const lines = (n: number) =>
      Array.from({ length: n }, () => ({ total: "0.01", unitPrice: "0.01" }));
    const summary = [{ rate: "22.00", imponibile: "2.01", imposta: "0.44" }];
    expect(() =>
      run(
        one({
          lines: lines(XML_MAX_LINES),
          summary: [{ rate: "22.00", imponibile: "2.00", imposta: "0.44" }],
          totale: "2.44",
        }),
      ),
    ).not.toThrow();
    expect(refused(one({ lines: lines(XML_MAX_LINES + 1), summary, totale: "2.45" }))).toEqual([
      "xml_content_unsupported",
      "too_many_lines",
    ]);
  });

  it(`more than ${XML_MAX_BODIES} bodies, and exactly ${XML_MAX_BODIES} accepted`, () => {
    expect(() => run({ bodies: Array.from({ length: XML_MAX_BODIES }, () => ({})) })).not.toThrow();
    expect(refused({ bodies: Array.from({ length: XML_MAX_BODIES + 1 }, () => ({})) })).toEqual([
      "xml_content_unsupported",
      "too_many_bodies",
    ]);
  });

  it("amounts beyond the column ranges", () => {
    expect(
      details(
        one({
          lines: [{ total: "10000000.01", unitPrice: "10000000.01" }],
          summary: [{ rate: "22.00", imponibile: "10.00", imposta: "2.20" }],
        }),
      ),
    ).toEqual([{ body: 1, line: 1, reason: "amount_out_of_range" }]);
    expect(reason(one({ lines: [{ qty: "100000000.00" }] }))).toBe("amount_out_of_range");
    expect(
      reason(
        one({
          summary: [{ rate: "22.00", imponibile: "10000000.01", imposta: "2.20" }],
          totale: "12.20",
        }),
      ),
    ).toBe("amount_out_of_range");
    expect(() =>
      run(
        one({
          lines: [{ total: "10000000.00", unitPrice: "10000000.00" }],
          summary: [{ rate: "22.00", imponibile: "10000000.00", imposta: "2.20" }],
          totale: "10000000.00",
        }),
      ),
    ).not.toThrow();
  });

  it("a line whose extra data would not fit the column", () => {
    const other = Array.from({ length: 200 }, (_, i) => ({
      tipo: "T",
      testo: `valore ${i} ${"x".repeat(40)}`,
    }));
    expect(details(one({ lines: [{ other }] }))).toEqual([
      { body: 1, line: 1, reason: "line_details_too_large" },
    ]);
  });
});

describe("content that is invalid", () => {
  const fields = (spec: FileSpec | string): string[] =>
    refusal(spec).details.map((d) => d.field ?? "");

  it("an Italian supplier VAT number with a wrong check digit, or no name", () => {
    expect(refused({ supplierVat: "IT12345678900" })).toEqual(["xml_invalid_content", "invalid"]);
    expect(fields({ supplierVat: "IT12345678900" })).toEqual(["CedentePrestatore.IdFiscaleIVA"]);
    expect(fields({ supplierName: null })).toEqual(["CedentePrestatore.Anagrafica"]);
  });

  it("a missing header or body", () => {
    expect(
      refusal(fileXml().replace(/<FatturaElettronicaHeader>.*<\/FatturaElettronicaHeader>/s, ""))
        .details,
    ).toEqual([{ field: "FatturaElettronicaHeader" }]);
    expect(refusal({ bodies: [] }).details).toEqual([{ field: "FatturaElettronicaBody" }]);
  });

  it("a missing number, a number without a digit, a number over 20 characters", () => {
    expect(fields(one({ numero: null }))).toEqual(["DatiGeneraliDocumento.Numero"]);
    expect(fields(one({ numero: "ABC" }))).toEqual(["DatiGeneraliDocumento.Numero"]);
    expect(fields(one({ numero: "1".repeat(21) }))).toEqual(["DatiGeneraliDocumento.Numero"]);
    expect(() => run(one({ numero: "1".repeat(20) }))).not.toThrow();
  });

  it("dates that are not calendar dates, or before 1970", () => {
    expect(fields(one({ date: "1998-02-30" }))).toEqual(["DatiGeneraliDocumento.Data"]);
    expect(fields(one({ date: "1969-12-31" }))).toEqual(["DatiGeneraliDocumento.Data"]);
    expect(() => run(one({ date: "1970-01-01" }))).not.toThrow();
  });

  it("a VAT rate of 0 without a nature, and a nature with a rate of 22", () => {
    const zero = refusal(
      one({
        lines: [{ rate: "0.00" }],
        summary: [{ rate: "0.00", natura: "N4", imponibile: "10.00", imposta: "0.00" }],
      }),
    );
    expect(zero.details).toEqual([
      { body: 1, line: 1, field: "Natura" },
      { body: 1, line: 1, field: "DatiRiepilogo" },
    ]);
    const nature = refusal(one({ lines: [{ natura: "N4" }] }));
    expect(nature.details[0]).toEqual({ body: 1, line: 1, field: "Natura" });
    expect(
      fields(
        one({
          summary: [{ rate: "0.00", imponibile: "10.00", imposta: "0.00" }],
          lines: [{ rate: "0.00", natura: "N4" }],
        }),
      ),
    ).toContain("DatiRiepilogo.Natura");
  });

  it("a nature outside the list, such as the retired N2 and N3", () => {
    expect(
      fields(
        one({
          lines: [{ rate: "0.00", natura: "N2" }],
          summary: [{ rate: "0.00", natura: "N2", imponibile: "10.00", imposta: "0.00" }],
        }),
      ),
    ).toContain("Natura");
  });

  it("a line whose rate is not in the VAT summary", () => {
    expect(refusal(one({ lines: [{ rate: "10.00" }] })).details).toEqual([
      { body: 1, line: 1, field: "DatiRiepilogo" },
    ]);
  });

  it("no VAT summary at all, no lines at all, a missing description", () => {
    expect(fields(one({ summary: [] }))).toContain("DatiRiepilogo");
    expect(
      fields(one({ lines: [], summary: [{ rate: "22.00", imponibile: "0.00", imposta: "0.00" }] })),
    ).toEqual(["DettaglioLinee"]);
    expect(fields(one({ lines: [{ desc: "   " }] }))).toEqual(["Descrizione"]);
  });

  it("amounts and quantities that break the schema patterns", () => {
    expect(fields(one({ lines: [{ total: "10" }] }))).toContain("PrezzoTotale");
    expect(fields(one({ lines: [{ qty: "-1.00" }] }))).toContain("Quantita");
    expect(fields(one({ lines: [{ rate: "22.0" }] }))).toContain("AliquotaIVA");
    expect(fields(one({ totale: "12,20" }))).toEqual([
      "DatiGeneraliDocumento.ImportoTotaleDocumento",
    ]);
  });

  it("a description over 1000 characters", () => {
    expect(fields(one({ lines: [{ desc: "x".repeat(1001) }] }))).toEqual(["Descrizione"]);
  });

  it(`lists at most ${XML_MAX_DETAILS} problems, with the line number`, () => {
    const lines = Array.from({ length: 8 }, () => ({ total: "x" }));
    const error = refusal(one({ lines }));
    expect(error.details).toHaveLength(XML_MAX_DETAILS);
    expect(error.details[0]).toEqual({ body: 1, line: 1, field: "PrezzoTotale" });
  });

  it("never repeats the file's text in the reasons", () => {
    const secret = "SECRET-DESCRIPTION";
    const error = refusal(one({ lines: [{ desc: secret, total: "bad", rate: secret }] }));
    expect(JSON.stringify([error.message, error.reason, error.details])).not.toContain(secret);
  });
});

describe("labels", () => {
  it("every TipoDocumento of the schema has a label, and the natures too", () => {
    for (const td of ["TD01", "TD24", "TD25", ...REFUSED])
      expect(DOCUMENT_TYPE_LABELS[td]).toBeTruthy();
    expect(natureLabel("N4")).toBe("Esenti");
    expect(natureLabel("N9")).toBe("N9");
  });
});

// The XSD allows these once. A repeated one used to be read by its first copy only, so a second wrapper could carry what the
// rules refuse (split payment, withholding) unseen. Now any repeat is refused, naming the element.
describe("an element the XSD allows once, repeated, is refused", () => {
  // Duplicates the first `tag` found inside the first `parent` (the whole file when no parent is given), so a test can reach
  // the buyer's copy of an element the supplier's also has.
  const twice = (tag: string, parent?: string, text = fileXml()): string => {
    const dup = (xml: string) =>
      xml.replace(new RegExp(`<${tag}>.*?</${tag}>`, "s"), (whole) => whole + whole);
    return parent
      ? text.replace(new RegExp(`<${parent}>.*?</${parent}>`, "s"), (whole) => dup(whole))
      : dup(text);
  };
  const refusedField = (text: string): [string, string, unknown] => {
    const error = refusal(text);
    return [error.code, error.reason, error.details];
  };

  it.each([
    "FatturaElettronicaHeader",
    "DatiGenerali",
    "DatiGeneraliDocumento",
    "DatiBeniServizi",
    "CedentePrestatore",
    "CessionarioCommittente",
    "IdFiscaleIVA",
    "Anagrafica",
    "Divisa",
    "TipoDocumento",
  ])("%s twice", (tag) => {
    expect(refusedField(twice(tag))).toEqual(["xml_invalid_content", "invalid", [{ field: tag }]]);
  });

  it.each([
    ["CedentePrestatore", "DatiAnagrafici", fileXml()],
    ["CessionarioCommittente", "DatiAnagrafici", fileXml()],
    ["CessionarioCommittente", "IdFiscaleIVA", fileXml()],
    [
      "DatiGeneraliDocumento",
      "DatiBollo",
      fileXml(
        one({
          docExtra:
            "<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo>",
        }),
      ),
    ],
    [
      "FatturaElettronicaBody",
      "DatiVeicoli",
      fileXml(
        one({
          bodyExtra:
            "<DatiVeicoli><Data>2020-01-01</Data><TotalePercorso>10</TotalePercorso></DatiVeicoli>",
        }),
      ),
    ],
  ])("%s's %s twice (the right copy)", (parent, tag, text) => {
    expect(refusedField(twice(tag, parent, text))).toEqual([
      "xml_invalid_content",
      "invalid",
      [{ field: tag }],
    ]);
  });

  it("the rules step itself refuses a repeated DatiGeneraliDocumento, before any mapping", () => {
    const doc = readFatturaXml(bytesOf(twice("DatiGeneraliDocumento")));
    const body = children(doc.root, "FatturaElettronicaBody")[0]!;
    const refusesIt = (fn: () => unknown) =>
      expect(fn).toThrow(
        expect.objectContaining({
          code: "xml_invalid_content",
          details: [{ field: "DatiGeneraliDocumento" }],
        }),
      );
    refusesIt(() => documentTypeOf(body));
    refusesIt(() => findUnsupportedContent(body, 1, new Reasons()));
  });

  it("the second DatiBeniServizi that carries split payment and a withholding flag is not ignored", () => {
    const hidden =
      "<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Ritenuta>SI</Ritenuta></DettaglioLinee>" +
      "<DatiRiepilogo><EsigibilitaIVA>S</EsigibilitaIVA></DatiRiepilogo></DatiBeniServizi>";
    const text = fileXml().replace("</DatiBeniServizi>", "</DatiBeniServizi>" + hidden);
    expect(refusedField(text)).toEqual([
      "xml_invalid_content",
      "invalid",
      [{ field: "DatiBeniServizi" }],
    ]);
  });

  it("a line's Ritenuta twice (NO then SI) is refused, not read as NO", () => {
    const text = fileXml(one({ lines: [{ ritenuta: "NO" }] })).replace(
      "<Ritenuta>NO</Ritenuta>",
      "<Ritenuta>NO</Ritenuta><Ritenuta>SI</Ritenuta>",
    );
    expect(refusal(text).details).toEqual([{ field: "Ritenuta" }]);
  });

  it("a second DatiGeneraliDocumento with a foreign currency is not ignored", () => {
    const text = fileXml().replace(
      "</DatiGeneraliDocumento>",
      "</DatiGeneraliDocumento><DatiGeneraliDocumento><Divisa>USD</Divisa></DatiGeneraliDocumento>",
    );
    expect(refusal(text).details).toEqual([{ field: "DatiGeneraliDocumento" }]);
  });

  it("a second body's repeated wrapper is refused too", () => {
    const body = (text: string) =>
      /<FatturaElettronicaBody>.*<\/FatturaElettronicaBody>/s.exec(text)![0];
    const base = fileXml();
    const broken = body(base).replace(/<DatiBeniServizi>.*?<\/DatiBeniServizi>/s, (w) => w + w);
    const text = base.replace(body(base), body(base) + broken);
    expect(refusal(text).details).toEqual([{ field: "DatiBeniServizi" }]);
  });

  // Repeats the XSD allows and the rules accept. DatiRitenuta is left out: a withholding is refused by the rules whatever its count.
  it("a repeatable element (DettaglioLinee, Allegati, DatiDDT, CodiceArticolo, ScontoMaggiorazione, AltriDatiGestionali) is accepted more than once", () => {
    const line = {
      codes: [
        ["EAN", "1"],
        ["INT", "2"],
      ] as [string, string][],
      discounts: [
        { tipo: "SC", perc: "10.00" },
        { tipo: "SC", perc: "5.00" },
      ],
      other: [
        { tipo: "A", testo: "x" },
        { tipo: "B", testo: "y" },
      ],
      total: "8.55",
    };
    const attachment =
      "<Allegati><NomeAttachment>a</NomeAttachment><Attachment>QQ==</Attachment></Allegati>";
    const ddt = "<DatiDDT><NumeroDDT>1</NumeroDDT><DataDDT>2020-01-01</DataDDT></DatiDDT>";
    const text = fileXml(
      one({
        lines: [line, line],
        generalExtra: ddt + ddt,
        bodyExtra: attachment + attachment,
      }),
    );
    // Every copy is read, not only the first: two lines, each with both codes, both discounts and both other-data entries.
    const { bodies } = run(text) as MappedFile;
    expect(
      bodies[0]!.lines.map(({ xmlDetails: d }) => [
        d.codes.length,
        d.discounts.length,
        d.otherData.length,
      ]),
    ).toEqual([
      [2, 2, 2],
      [2, 2, 2],
    ]);
  });

  it("DatiRitenuta repeated is refused as withholding, not as a repeated element", () => {
    const withholding =
      "<DatiRitenuta><TipoRitenuta>RT01</TipoRitenuta><ImportoRitenuta>1.00</ImportoRitenuta></DatiRitenuta>";
    const error = refusal(one({ docExtra: withholding + withholding }));
    expect([error.code, error.details]).toEqual([
      "xml_content_unsupported",
      [{ body: 1, reason: "withholding" }],
    ]);
  });
});
