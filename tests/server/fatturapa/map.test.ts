import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LINE_AMOUNT_TOLERANCE_TEN_THOUSANDTHS } from "@/server/extraction/constants";
import { divDec, formatDec, parseDec } from "@/server/fatturapa/decimal";
import { FatturaError } from "@/server/fatturapa/errors";
import { mapFattura, type MappedFile } from "@/server/fatturapa/map";
import { readFatturaXml } from "@/server/fatturapa/xml";
import {
  bodyXml,
  bytesOf,
  fileXml,
  payment,
  type BodySpec,
  type FileSpec,
  type LineSpec,
  type SummarySpec,
} from "../../fixtures/fatturapa/build-xml";

const map = (spec: FileSpec = {}): MappedFile => mapFattura(readFatturaXml(bytesOf(fileXml(spec))));
const mapBody = (body: BodySpec) => map({ bodies: [body] }).bodies[0]!;
const row = (
  rate: string,
  imponibile: string,
  imposta: string,
  extra: Partial<SummarySpec> = {},
): SummarySpec => ({ rate, imponibile, imposta, ...extra });

describe("decimal maths on strings", () => {
  it("parses, rounds half away from zero and never uses a float", () => {
    expect(formatDec(parseDec("0.12345678")!, 4)).toBe("0.1235");
    expect(formatDec(parseDec("0.00005")!, 4)).toBe("0.0001");
    expect(formatDec(parseDec("-0.00005")!, 4)).toBe("-0.0001");
    expect(formatDec(parseDec("0.1")! + parseDec("0.2")!, 2)).toBe("0.30");
    expect(formatDec(parseDec("99999999999.99999999")!, 2)).toBe("100000000000.00");
    expect(formatDec(divDec(parseDec("27.00")!, parseDec("3.00")!), 4)).toBe("9.0000");
    expect(formatDec(divDec(parseDec("1.00")!, parseDec("3.00")!), 4)).toBe("0.3333");
    expect(formatDec(divDec(parseDec("2.00")!, parseDec("3.00")!), 4)).toBe("0.6667");
    expect(formatDec(0n, 4)).toBe("0.0000");
    expect(formatDec(-1n, 4)).toBe("0.0000");
  });

  it("refuses text that is not a plain decimal", () => {
    for (const bad of ["", "1e3", "1,5", " 1", "1.", ".5", "--1", "0.123456789", "NaN"])
      expect(parseDec(bad)).toBeNull();
  });
});

describe("a single ordinary invoice (FPR12)", () => {
  it("fills the header, the line, the summary and the buyer", () => {
    const file = map();
    expect(file.format).toBe("FPR12");
    expect(file.buyer).toEqual({ vat: "IT00000000000", cf: null });
    expect(file.bodies).toHaveLength(1);
    const body = file.bodies[0]!;
    expect(body.documentType).toBe("TD01");
    expect(body.notes).toEqual([]);
    expect(body.header).toEqual({
      supplierVat: "IT12345678903",
      supplierName: "Fornitore Demo 1",
      numberRaw: "FT 12",
      invoiceDate: "1998-11-03",
      dueDate: null,
      netTotal: "10.00",
      vatTotal: "2.20",
      grossTotal: "12.20",
    });
    expect(body.lines).toEqual([
      {
        rawDescription: "Prodotto demo",
        supplierCode: null,
        qty: "1.0000",
        unitRaw: null,
        unitPrice: "10.0000",
        lineAmount: "10.0000",
        vatRate: "22.00",
        vatNature: null,
        xmlDetails: {
          lineNumber: 1,
          kind: null,
          codes: [],
          otherData: [],
          discounts: [],
          listUnitPrice: "10.0000",
          periodStart: null,
          periodEnd: null,
        },
      },
    ]);
    expect(body.vatSummary).toEqual([
      {
        vatRate: "22.00",
        vatNature: null,
        taxable: "10.00",
        tax: "2.20",
        rounding: null,
        accessoryCosts: null,
        vatChargeability: null,
        legalReference: null,
      },
    ]);
  });

  it("reads the supplier of a sole trader from Nome and Cognome, and a foreign VAT number", () => {
    const person = map({ supplierName: "<Nome>Maria</Nome><Cognome>Demo</Cognome>" }).bodies[0]!
      .header.supplierName;
    expect(person).toBe("Maria Demo");
    const foreign = map({ supplierCountry: "DE", supplierVat: "DE123456789" }).bodies[0]!.header
      .supplierVat;
    expect(foreign).toBe("DE123456789");
  });

  it("reads the buyer's codice fiscale when there is no VAT number, and reads FPA12 and a default namespace", () => {
    expect(map({ buyerVat: null, buyerCf: "00000000000" }).buyer).toEqual({
      vat: null,
      cf: "00000000000",
    });
    expect(map({ versione: "FPA12" }).format).toBe("FPA12");
    expect(map({ prefix: null }).bodies[0]!.header.numberRaw).toBe("FT 12");
  });
});

describe("lines", () => {
  const multi: LineSpec[] = [
    {
      desc: "Olio demo",
      qty: "3.00",
      unit: "LT",
      unitPrice: "10.00",
      discounts: [{ tipo: "SC", perc: "10.00" }],
      total: "27.00",
      rate: "10.00",
      codes: [
        ["EAN", "8000000000001"],
        ["INT", "A-1"],
      ],
    },
    { desc: "Acqua demo", qty: "2.00", unitPrice: "5.00", total: "10.00", rate: "22.00" },
    {
      desc: "Servizio esente",
      qty: "1.00",
      unitPrice: "4.00",
      total: "4.00",
      rate: "0.00",
      natura: "N4",
    },
  ];
  const summary = [
    row("10.00", "27.00", "2.70"),
    row("22.00", "10.00", "2.20"),
    row("0.00", "4.00", "0.00", { natura: "N4" }),
  ];

  it("maps rates, nature, the effective net price and keeps the list price and the discount", () => {
    const body = mapBody({ lines: multi, summary, totale: "45.90" });
    expect(body.lines.map((line) => [line.vatRate, line.vatNature])).toEqual([
      ["10.00", null],
      ["22.00", null],
      ["0.00", "N4"],
    ]);
    const first = body.lines[0]!;
    expect(first.unitPrice).toBe("9.0000");
    expect(first.unitRaw).toBe("LT");
    expect(first.xmlDetails.listUnitPrice).toBe("10.0000");
    expect(first.xmlDetails.discounts).toEqual([{ type: "SC", percent: "10.00", amount: null }]);
    // qty x price equals the amount within the existing line tolerance: no amount_mismatch
    for (const line of body.lines) {
      const product = (parseDec(line.qty)! * parseDec(line.unitPrice!)!) / 10n ** 8n;
      const diff = product - parseDec(line.lineAmount)!;
      expect(Number((diff < 0n ? -diff : diff) / 10n ** 4n)).toBeLessThanOrEqual(
        LINE_AMOUNT_TOLERANCE_TEN_THOUSANDTHS,
      );
    }
    expect(body.header).toMatchObject({ netTotal: "41.00", vatTotal: "4.90", grossTotal: "45.90" });
    expect(body.vatSummary.map((r) => [r.vatRate, r.vatNature])).toEqual([
      ["10.00", null],
      ["22.00", null],
      ["0.00", "N4"],
    ]);
    expect(body.notes).toEqual([]);
  });

  it("takes the first CodiceArticolo as the supplier code and keeps all of them", () => {
    const body = mapBody({ lines: multi, summary, totale: "45.90" });
    expect(body.lines[0]!.supplierCode).toBe("8000000000001");
    expect(body.lines[0]!.xmlDetails.codes).toEqual([
      { type: "EAN", value: "8000000000001" },
      { type: "INT", value: "A-1" },
    ]);
    expect(body.lines[1]!.supplierCode).toBeNull();
  });

  it("keeps AltriDatiGestionali such as lot and expiry as data, without filling the lot", () => {
    const body = mapBody({
      lines: [
        {
          other: [
            { tipo: "LOTTO", testo: "L-DEMO-0001" },
            { tipo: "SCADENZA", data: "1998-12-01" },
            { tipo: "PESO", numero: "1.50" },
          ],
        },
      ],
    });
    expect(body.lines[0]!.xmlDetails.otherData).toEqual([
      { type: "LOTTO", text: "L-DEMO-0001", number: null, date: null },
      { type: "SCADENZA", text: null, number: null, date: "1998-12-01" },
      { type: "PESO", text: null, number: "1.5000", date: null },
    ]);
  });

  it("keeps the kind and the period of a line", () => {
    const details = mapBody({ lines: [{ kind: "AC", start: "1998-10-01", end: "1998-10-31" }] })
      .lines[0]!.xmlDetails;
    expect([details.kind, details.periodStart, details.periodEnd]).toEqual([
      "AC",
      "1998-10-01",
      "1998-10-31",
    ]);
  });

  it("a missing quantity is 1", () => {
    const line = mapBody({
      lines: [{ qty: null, unitPrice: "7.00", total: "7.00" }],
      summary: [row("22.00", "7.00", "1.54")],
      totale: "8.54",
    }).lines[0]!;
    expect([line.qty, line.unitPrice, line.lineAmount]).toEqual(["1.0000", "7.0000", "7.0000"]);
  });

  it("rounds the quantity to 4 decimals with string maths", () => {
    const line = mapBody({
      lines: [{ qty: "0.12345678", unitPrice: "10.00", total: "1.23" }],
      summary: [row("22.00", "1.23", "0.27")],
      totale: "1.50",
    }).lines[0]!;
    expect(line.qty).toBe("0.1235");
    expect(line.unitPrice).toBe("9.9595");
  });

  it("keeps a line with a quantity and no amount, and falls back to the list price when the quantity rounds to zero", () => {
    const free = mapBody({
      lines: [{ qty: "3.00", unitPrice: "0.00", total: "0.00" }, { qty: "5.00" }],
      summary: [row("22.00", "10.00", "2.20")],
    }).lines;
    expect(free[0]).toMatchObject({ qty: "3.0000", unitPrice: "0.0000", lineAmount: "0.0000" });
    const tiny = mapBody({ lines: [{ qty: "0.00001", unitPrice: "5.00", total: "10.00" }] })
      .lines[0]!;
    expect([tiny.qty, tiny.unitPrice]).toEqual(["0.0000", "5.0000"]);
  });

  it("does not import a text-only line, and says so", () => {
    const body = mapBody({
      lines: [
        { desc: "DDT 12 del 03/11", qty: null, unitPrice: "0.00", total: "0.00", rate: "0.00" },
        {},
      ],
    });
    expect(body.lines).toHaveLength(1);
    expect(body.notes).toEqual(["text_lines_skipped"]);
  });

  it("cuts a long description to 500 code points and strips control and bidi characters", () => {
    expect(mapBody({ lines: [{ desc: "à".repeat(900) }] }).lines[0]!.rawDescription).toHaveLength(
      500,
    );
    expect(mapBody({ lines: [{ desc: "😀".repeat(600) }] }).lines[0]!.rawDescription).toBe(
      "😀".repeat(500),
    );
    expect(mapBody({ lines: [{ desc: "Pa‮sta\tdemo‏\n" }] }).lines[0]!.rawDescription).toBe(
      "Pasta demo",
    );
  });
});

describe("the VAT summary against the lines", () => {
  it("adds one line for a positive rounding difference, and a note", () => {
    const body = mapBody({ summary: [row("22.00", "10.40", "2.29")], totale: "12.69" });
    expect(body.lines).toHaveLength(2);
    expect(body.lines[1]).toMatchObject({
      rawDescription: "Differenza dal riepilogo IVA 22%",
      qty: "1.0000",
      unitPrice: "0.4000",
      lineAmount: "0.4000",
      vatRate: "22.00",
      vatNature: null,
      supplierCode: null,
    });
    expect(body.lines[1]!.xmlDetails).toMatchObject({ kind: "residual", lineNumber: null });
    expect(body.notes).toEqual(["rounding_line_added"]);
  });

  it("names the nature in the residual line of an exempt rate", () => {
    const body = mapBody({
      lines: [{ rate: "0.00", natura: "N4" }],
      summary: [row("0.00", "10.50", "0.00", { natura: "N4" })],
      totale: "10.50",
    });
    expect(body.lines[1]!.rawDescription).toBe("Differenza dal riepilogo IVA 0% (N4)");
  });

  it("adds no line for a negative difference, only a note; and ignores a difference under half a cent", () => {
    const negative = mapBody({ summary: [row("22.00", "9.60", "2.11")], totale: "11.71" });
    expect(negative.lines).toHaveLength(1);
    expect(negative.notes).toEqual(["riepilogo_negative_residual"]);
    const even = mapBody({});
    expect(even.notes).toEqual([]);
  });

  it("the totals are the sums of the summary and the document total, or net plus VAT when it is absent", () => {
    const two = mapBody({
      lines: [{ rate: "10.00" }, { rate: "22.00" }],
      summary: [row("10.00", "10.00", "1.00"), row("22.00", "10.00", "2.20")],
      totale: "23.20",
    });
    expect(two.header).toMatchObject({ netTotal: "20.00", vatTotal: "3.20", grossTotal: "23.20" });
    const none = mapBody({ totale: null });
    expect(none.header.grossTotal).toBe("12.20");
    const stamp = mapBody({ totale: "14.20" });
    expect(stamp.header.grossTotal).toBe("14.20");
  });
});

describe("due date and notes", () => {
  it("takes the earliest instalment and notes the instalments", () => {
    const body = mapBody({
      payments: payment({ scadenza: "1998-12-03" }, { scadenza: "1998-11-20" }),
    });
    expect(body.header.dueDate).toBe("1998-11-20");
    expect(body.notes).toEqual(["instalments"]);
  });

  it("a single payment date is not an instalment note", () => {
    const body = mapBody({ payments: payment({ scadenza: "1998-12-03" }) });
    expect([body.header.dueDate, body.notes]).toEqual(["1998-12-03", []]);
  });

  it("adds the days to the reference date, across a month end and a leap year", () => {
    expect(
      mapBody({ payments: payment({ riferimento: "1998-11-03", giorni: "30" }) }).header.dueDate,
    ).toBe("1998-12-03");
    expect(
      mapBody({
        date: "1996-01-31",
        payments: payment({ riferimento: "1996-01-31", giorni: "30" }),
      }).header.dueDate,
    ).toBe("1996-03-01");
  });

  it("has no due date without payment data", () => {
    expect(mapBody({}).header.dueDate).toBeNull();
  });

  it("notes every block that is not imported, in a fixed order", () => {
    const body = mapBody({
      docExtra:
        "<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo><ScontoMaggiorazione><Tipo>SC</Tipo><Importo>1.00</Importo></ScontoMaggiorazione>",
      generalExtra:
        "<DatiOrdineAcquisto><IdDocumento>ORD-1</IdDocumento></DatiOrdineAcquisto><DatiDDT><NumeroDDT>1</NumeroDDT><DataDDT>1998-11-01</DataDDT></DatiDDT>",
      bodyExtra:
        "<DatiVeicoli><Data>1998-11-01</Data><TotalePercorso>1</TotalePercorso></DatiVeicoli><Allegati><NomeAttachment>a.pdf</NomeAttachment><Attachment>QUJD</Attachment></Allegati>",
    });
    expect(body.notes).toEqual([
      "attachments",
      "ddt_refs",
      "order_refs",
      "document_discount",
      "stamp_duty",
      "vehicle_data",
    ]);
  });
});

describe("a file with several bodies", () => {
  it("becomes one invoice per body, in order, with the supplier of the header", () => {
    const file = map({
      bodies: [{ numero: "FT 1" }, { numero: "FT 2", td: "TD24" }, { numero: "FT 3", td: "TD25" }],
    });
    expect(
      file.bodies.map((b) => [b.header.numberRaw, b.documentType, b.header.supplierVat]),
    ).toEqual([
      ["FT 1", "TD01", "IT12345678903"],
      ["FT 2", "TD24", "IT12345678903"],
      ["FT 3", "TD25", "IT12345678903"],
    ]);
  });
});

describe("the mapper never takes what it should not keep", () => {
  it("leaves no IBAN, address or codice fiscale of the supplier in the result", () => {
    const text = JSON.stringify(
      map({
        bodies: [
          {
            payments: payment({ scadenza: "1998-12-03" }).replace(
              "<ImportoPagamento>",
              "<IBAN>IT60X0542811101000000123456</IBAN><ImportoPagamento>",
            ),
          },
        ],
      }),
    );
    expect(text).not.toContain("IT60X0542811101000000123456");
    expect(text).not.toContain("Via Demo");
  });

  it("is a FatturaError and nothing else for a file without a body", () => {
    const doc = readFatturaXml(bytesOf(fileXml({ bodies: [] })));
    expect(() => mapFattura(doc)).toThrowError(FatturaError);
  });
});

describe("what the body builder makes is itself a valid body", () => {
  it("is shaped like the official element order", () => {
    expect(bodyXml()).toContain("<DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento>");
  });
});

describe("the fixture files", () => {
  const load = (name: string) =>
    mapFattura(
      readFatturaXml(
        new Uint8Array(readFileSync(new URL(`../../fixtures/fatturapa/${name}`, import.meta.url))),
      ),
    );

  it("FPR01 is one invoice with a due date from the payment terms", () => {
    const body = load("FPR01-single.xml").bodies[0]!;
    expect([body.header.numberRaw, body.header.dueDate, body.lines.length]).toEqual([
      "FT 12",
      "1998-12-03",
      1,
    ]);
  });

  it("FPR02 has three lines over three rates, a lot, an expiry and a discount", () => {
    const body = load("FPR02-multi-line.xml").bodies[0]!;
    expect(body.lines.map((l) => [l.vatRate, l.vatNature, l.unitPrice])).toEqual([
      ["10.00", null, "9.0000"],
      ["22.00", null, "0.5000"],
      ["0.00", "N4", "4.0000"],
    ]);
    expect(body.lines[0]!.xmlDetails.otherData.map((d) => d.type)).toEqual(["LOTTO", "SCADENZA"]);
    expect(body.notes).toEqual([]);
  });

  it("FPR03 is three deferred invoices", () => {
    expect(load("FPR03-lotto.xml").bodies.map((b) => [b.header.numberRaw, b.documentType])).toEqual(
      [
        ["FT 21", "TD24"],
        ["FT 22", "TD24"],
        ["FT 23", "TD24"],
      ],
    );
  });

  it("FPR04 is a credit note and is refused", () => {
    expect(() => load("FPR04-credit-note.xml")).toThrowError(FatturaError);
  });
});
