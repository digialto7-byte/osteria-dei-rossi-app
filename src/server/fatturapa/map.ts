/**
 * From the element tree of a FatturaPA file to the invoices Costì imports (plan sections 3.3.3 to
 * 3.3.5). Deterministic and pure: no clock, no I/O, no float. Order of refusals: too many bodies,
 * document type, unsupported content by presence, invalid fields, then the numeric rules.
 *
 * Not kept, on purpose (data minimisation): IBAN, addresses, contacts, the supplier's codice
 * fiscale, Causale and the attachments. The buyer's codice fiscale is returned for the buyer check only.
 */
import { isValidItVat } from "@/lib/vat/it-vat";
import { clean } from "@/server/extraction/checks";
import {
  XML_MAX_AMOUNT,
  XML_MAX_DESCRIPTION_CHARS,
  XML_MAX_DETAILS_BYTES,
  XML_MAX_LINES,
  XML_MAX_QTY_EXCLUSIVE,
  XML_NOTES,
} from "@/server/fatturapa/constants";
import { divDec, formatDec, parseDec, wholeDec } from "@/server/fatturapa/decimal";
import { FatturaError } from "@/server/fatturapa/errors";
import {
  Reasons,
  findUnsupportedContent,
  refuseMissingGoods,
  refuseTooManyBodies,
  refuseUnsupportedDocumentTypes,
  throwInvalid,
  throwUnsupported,
} from "@/server/fatturapa/rules";
import * as s from "@/server/fatturapa/schema";
import { child, children, textOf, type XmlDocument, type XmlNode } from "@/server/fatturapa/xml";
import type { z } from "zod";

export type XmlNote = (typeof XML_NOTES)[number];

export interface MappedLineDetails {
  /** NumeroLinea of the file; null for the line Costì adds for a rounding difference. */
  lineNumber: number | null;
  kind: "SC" | "PR" | "AB" | "AC" | "residual" | null;
  codes: { type: string; value: string }[];
  otherData: { type: string; text: string | null; number: string | null; date: string | null }[];
  discounts: { type: string; percent: string | null; amount: string | null }[];
  listUnitPrice: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface MappedLine {
  rawDescription: string;
  supplierCode: string | null;
  qty: string;
  unitRaw: string | null;
  unitPrice: string | null;
  lineAmount: string;
  vatRate: string;
  vatNature: string | null;
  xmlDetails: MappedLineDetails;
}

export interface MappedVatSummary {
  vatRate: string;
  vatNature: string | null;
  taxable: string;
  tax: string;
  rounding: string | null;
  accessoryCosts: string | null;
  vatChargeability: "I" | "D" | null;
  legalReference: string | null;
}

export interface MappedBody {
  documentType: "TD01" | "TD24" | "TD25";
  notes: XmlNote[];
  header: {
    supplierVat: string;
    supplierName: string;
    numberRaw: string;
    invoiceDate: string;
    dueDate: string | null;
    netTotal: string;
    vatTotal: string;
    grossTotal: string;
  };
  lines: MappedLine[];
  vatSummary: MappedVatSummary[];
}

export interface MappedFile {
  format: XmlDocument["versione"];
  /** Only for the buyer check: the buyer's VAT number and codice fiscale as written in the file. */
  buyer: { vat: string | null; cf: string | null };
  bodies: MappedBody[];
}

const FOREIGN_VAT = /^[A-Z]{2}[0-9A-Z]{2,12}$/;
const MAX_AMOUNT = wholeDec(XML_MAX_AMOUNT);
const MAX_QTY_EXCLUSIVE = wholeDec(XML_MAX_QTY_EXCLUSIVE);
const ONE = wholeDec("1");
const HALF_CENT = 500_000n; // 0.005 in units of 10^-8

/** Reads fields of one body and records what is wrong, by field name. */
class BodyReader {
  constructor(
    readonly body: number,
    readonly invalid: Reasons,
    readonly unsupported: Reasons,
  ) {}

  /** A trimmed text that must exist and fit the schema; records the field when it does not. */
  required(
    parent: XmlNode | undefined,
    name: string,
    schema: z.ZodType,
    field: string,
    line?: number,
  ): string | undefined {
    const value = textOf(parent, name);
    if (value === undefined || !schema.safeParse(value).success) {
      this.invalid.add({ body: this.body, ...(line === undefined ? {} : { line }), field });
      return undefined;
    }
    return value;
  }

  optional(
    parent: XmlNode | undefined,
    name: string,
    schema: z.ZodType,
    field: string,
    line?: number,
  ): string | undefined {
    if (textOf(parent, name) === undefined) return undefined;
    return this.required(parent, name, schema, field, line);
  }

  refuse(reason: string, line?: number): void {
    this.unsupported.add({ body: this.body, ...(line === undefined ? {} : { line }), reason });
  }
}

const cutCodePoints = (text: string, max: number): string =>
  Array.from(text).slice(0, max).join("");

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** "22", "5,5" or "0 (N4)": the rate as an owner reads it. */
function rateLabel(rate: string, nature: string | null): string {
  const text = rate
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")
    .replace(".", ",");
  return nature ? `${text}% (${nature})` : `${text}%`;
}

interface ParsedFile {
  header: XmlNode;
  bodies: XmlNode[];
}

function mapSupplier(file: ParsedFile, reasons: Reasons): { vat: string; name: string } | null {
  const data = child(child(file.header, "CedentePrestatore"), "DatiAnagrafici");
  const id = child(data, "IdFiscaleIVA");
  const country = textOf(id, "IdPaese")?.toUpperCase();
  const code = textOf(id, "IdCodice")?.toUpperCase();
  const vat = country !== undefined && code !== undefined ? `${country}${code}` : undefined;
  const vatOk =
    vat !== undefined && (vat.startsWith("IT") ? isValidItVat(vat) : FOREIGN_VAT.test(vat));
  if (!vatOk) reasons.add({ field: "CedentePrestatore.IdFiscaleIVA" });

  const personal = child(data, "Anagrafica");
  const company = textOf(personal, "Denominazione");
  const given = [textOf(personal, "Nome"), textOf(personal, "Cognome")]
    .filter((part) => part !== undefined)
    .join(" ");
  const name = clean(company ?? given);
  if (name === "" || name.length > 200) reasons.add({ field: "CedentePrestatore.Anagrafica" });
  return vatOk && name !== "" && name.length <= 200 ? { vat: vat!, name } : null;
}

function mapBuyer(file: ParsedFile): MappedFile["buyer"] {
  const data = child(child(file.header, "CessionarioCommittente"), "DatiAnagrafici");
  const id = child(data, "IdFiscaleIVA");
  const country = textOf(id, "IdPaese")?.toUpperCase();
  const code = textOf(id, "IdCodice")?.toUpperCase();
  const cf = textOf(data, "CodiceFiscale")?.toUpperCase();
  return {
    vat: country !== undefined && code !== undefined ? `${country}${code}` : null,
    cf: cf !== undefined && s.fiscalCode.safeParse(cf).success ? cf : null,
  };
}

function mapSummary(
  reader: BodyReader,
  rows: XmlNode[],
): { rows: MappedVatSummary[]; imponibile: Map<string, bigint>; net: bigint; vat: bigint } {
  const out: MappedVatSummary[] = [];
  const imponibile = new Map<string, bigint>();
  let net = 0n;
  let vat = 0n;
  rows.forEach((row) => {
    const rate = reader.required(row, "AliquotaIVA", s.rate, "DatiRiepilogo.AliquotaIVA");
    const nature = reader.optional(row, "Natura", s.natura, "DatiRiepilogo.Natura") ?? null;
    if (rate !== undefined && (Number(rate) === 0) !== (nature !== null)) {
      reader.invalid.add({ body: reader.body, field: "DatiRiepilogo.Natura" });
    }
    const taxable = reader.required(
      row,
      "ImponibileImporto",
      s.amount2,
      "DatiRiepilogo.ImponibileImporto",
    );
    const tax = reader.required(row, "Imposta", s.amount2, "DatiRiepilogo.Imposta");
    const accessory = reader.optional(
      row,
      "SpeseAccessorie",
      s.amount2,
      "DatiRiepilogo.SpeseAccessorie",
    );
    const rounding = reader.optional(
      row,
      "Arrotondamento",
      s.amount8,
      "DatiRiepilogo.Arrotondamento",
    );
    const chargeability = reader.optional(
      row,
      "EsigibilitaIVA",
      s.chargeability,
      "DatiRiepilogo.EsigibilitaIVA",
    );
    const legal = reader.optional(
      row,
      "RiferimentoNormativo",
      s.shortText(100),
      "DatiRiepilogo.RiferimentoNormativo",
    );
    if (rate === undefined || taxable === undefined || tax === undefined) return;
    const taxableDec = parseDec(taxable)!;
    const taxDec = parseDec(tax)!;
    const accessoryDec = accessory === undefined ? null : parseDec(accessory)!;
    if (taxableDec < 0n || taxDec < 0n || (accessoryDec !== null && accessoryDec < 0n))
      reader.refuse("negative_total");
    const key = `${rate}|${nature ?? ""}`;
    imponibile.set(key, (imponibile.get(key) ?? 0n) + taxableDec);
    net += taxableDec;
    vat += taxDec;
    out.push({
      vatRate: rate,
      vatNature: nature,
      taxable: formatDec(taxableDec, 2),
      tax: formatDec(taxDec, 2),
      rounding: rounding === undefined ? null : formatDec(parseDec(rounding)!, 4),
      accessoryCosts: accessoryDec === null ? null : formatDec(accessoryDec, 4),
      vatChargeability: chargeability === undefined ? null : (chargeability as "I" | "D"),
      legalReference: legal === undefined ? null : clean(legal),
    });
  });
  return { rows: out, imponibile, net, vat };
}

function mapLineDetails(reader: BodyReader, node: XmlNode, line: number): MappedLineDetails {
  const codes = children(node, "CodiceArticolo").map((code) => ({
    type: reader.required(code, "CodiceTipo", s.shortText(35), "CodiceArticolo.CodiceTipo", line),
    value: reader.required(
      code,
      "CodiceValore",
      s.shortText(35),
      "CodiceArticolo.CodiceValore",
      line,
    ),
  }));
  const discounts = children(node, "ScontoMaggiorazione").map((discount) => {
    const amount = reader.optional(
      discount,
      "Importo",
      s.amount8,
      "ScontoMaggiorazione.Importo",
      line,
    );
    return {
      type: reader.required(discount, "Tipo", s.discountType, "ScontoMaggiorazione.Tipo", line),
      percent:
        reader.optional(discount, "Percentuale", s.rate, "ScontoMaggiorazione.Percentuale", line) ??
        null,
      amount: amount === undefined ? null : formatDec(parseDec(amount)!, 4),
    };
  });
  const otherData = children(node, "AltriDatiGestionali").map((data) => {
    const text = reader.optional(
      data,
      "RiferimentoTesto",
      s.shortText(60),
      "AltriDatiGestionali.RiferimentoTesto",
      line,
    );
    const number = reader.optional(
      data,
      "RiferimentoNumero",
      s.amount8,
      "AltriDatiGestionali.RiferimentoNumero",
      line,
    );
    return {
      type: reader.required(
        data,
        "TipoDato",
        s.shortText(10),
        "AltriDatiGestionali.TipoDato",
        line,
      ),
      text: text === undefined ? null : clean(text),
      number: number === undefined ? null : formatDec(parseDec(number)!, 4),
      date:
        reader.optional(
          data,
          "RiferimentoData",
          s.isoDate,
          "AltriDatiGestionali.RiferimentoData",
          line,
        ) ?? null,
    };
  });
  const kind = reader.optional(
    node,
    "TipoCessionePrestazione",
    s.lineKind,
    "TipoCessionePrestazione",
    line,
  );
  const list = reader.optional(node, "PrezzoUnitario", s.amount8, "PrezzoUnitario", line);
  return {
    lineNumber: line,
    kind: kind === "SC" || kind === "PR" || kind === "AB" || kind === "AC" ? kind : null,
    codes: codes.map((c) => ({ type: clean(c.type ?? ""), value: clean(c.value ?? "") })),
    otherData: otherData.map((d) => ({ ...d, type: clean(d.type ?? "") })),
    discounts: discounts.map((d) => ({ ...d, type: d.type ?? "" })),
    listUnitPrice: list === undefined ? null : formatDec(parseDec(list)!, 4),
    periodStart:
      reader.optional(node, "DataInizioPeriodo", s.isoDate, "DataInizioPeriodo", line) ?? null,
    periodEnd: reader.optional(node, "DataFinePeriodo", s.isoDate, "DataFinePeriodo", line) ?? null,
  };
}

function mapBody(
  reader: BodyReader,
  body: XmlNode,
  supplier: { vat: string; name: string },
): MappedBody | null {
  const general = child(child(body, "DatiGenerali"), "DatiGeneraliDocumento");
  const goods = child(body, "DatiBeniServizi")!; // refuseMissingGoods ran in mapFattura
  const documentType = reader.required(
    general,
    "TipoDocumento",
    s.documentTypeCode,
    "DatiGeneraliDocumento.TipoDocumento",
  );
  const date = reader.required(general, "Data", s.isoDate, "DatiGeneraliDocumento.Data");
  const number = reader.required(
    general,
    "Numero",
    s.documentNumber,
    "DatiGeneraliDocumento.Numero",
  );
  const grossText = reader.optional(
    general,
    "ImportoTotaleDocumento",
    s.amount2,
    "DatiGeneraliDocumento.ImportoTotaleDocumento",
  );

  // The VAT summary first: lines must find their rate in it.
  const summaryNodes = children(goods, "DatiRiepilogo");
  if (summaryNodes.length === 0) reader.invalid.add({ body: reader.body, field: "DatiRiepilogo" });
  const summary = mapSummary(reader, summaryNodes);
  const summaryKeys = new Set(
    summaryNodes.map((row) => `${textOf(row, "AliquotaIVA") ?? ""}|${textOf(row, "Natura") ?? ""}`),
  );

  // Lines.
  const lines: MappedLine[] = [];
  const lineSums = new Map<string, bigint>();
  let skipped = 0;
  children(goods, "DettaglioLinee").forEach((node, index) => {
    const numberText = textOf(node, "NumeroLinea");
    const parsedNumber =
      numberText !== undefined && s.lineNumber.safeParse(numberText).success
        ? Number(numberText)
        : undefined;
    const lineNo = parsedNumber ?? index + 1;
    if (parsedNumber === undefined)
      reader.invalid.add({ body: reader.body, line: lineNo, field: "NumeroLinea" });

    const quantityText = textOf(node, "Quantita");
    const totalText = textOf(node, "PrezzoTotale");
    const totalDec = totalText === undefined ? null : parseDec(totalText);
    // A descriptive line (a DDT reference, a heading): no quantity and no amount. Not imported, counted.
    if (quantityText === undefined && totalDec === 0n) {
      skipped += 1;
      return;
    }

    const description = reader.required(
      node,
      "Descrizione",
      s.shortText(1000),
      "Descrizione",
      lineNo,
    );
    const cleaned =
      description === undefined
        ? ""
        : cutCodePoints(clean(description), XML_MAX_DESCRIPTION_CHARS).trim();
    if (description !== undefined && cleaned === "")
      reader.invalid.add({ body: reader.body, line: lineNo, field: "Descrizione" });
    const quantity = reader.optional(node, "Quantita", s.quantity, "Quantita", lineNo);
    const unitText = reader.optional(node, "UnitaMisura", s.shortText(10), "UnitaMisura", lineNo);
    const priceText = reader.required(node, "PrezzoUnitario", s.amount8, "PrezzoUnitario", lineNo);
    const total = reader.required(node, "PrezzoTotale", s.amount8, "PrezzoTotale", lineNo);
    const rate = reader.required(node, "AliquotaIVA", s.rate, "AliquotaIVA", lineNo);
    const nature = reader.optional(node, "Natura", s.natura, "Natura", lineNo) ?? null;
    if (rate !== undefined && (Number(rate) === 0) !== (nature !== null)) {
      reader.invalid.add({ body: reader.body, line: lineNo, field: "Natura" });
    }
    if (rate !== undefined && !summaryKeys.has(`${rate}|${nature ?? ""}`)) {
      reader.invalid.add({ body: reader.body, line: lineNo, field: "DatiRiepilogo" });
    }
    const details = mapLineDetails(reader, node, lineNo);
    if (cleaned === "" || priceText === undefined || total === undefined || rate === undefined)
      return;

    const amount = parseDec(total)!;
    const listPrice = parseDec(priceText)!;
    if (amount < 0n || listPrice < 0n) {
      reader.refuse("negative_line", lineNo);
      return;
    }
    const qtyDec = quantity === undefined ? ONE : parseDec(quantity)!;
    if (qtyDec >= MAX_QTY_EXCLUSIVE || amount > MAX_AMOUNT) {
      reader.refuse("amount_out_of_range", lineNo);
      return;
    }
    // The stored quantity (4 decimals); the effective net price follows from it, so that qty x price = amount.
    const storedQty = parseDec(formatDec(qtyDec, 4))!;
    const unitDec = storedQty > 0n ? parseDec(formatDec(divDec(amount, storedQty), 4))! : listPrice;
    if (unitDec > MAX_AMOUNT) {
      reader.refuse("amount_out_of_range", lineNo);
      return;
    }
    const codeValue = details.codes[0]?.value;
    const mapped: MappedLine = {
      rawDescription: cleaned,
      supplierCode:
        codeValue === undefined || codeValue === "" ? null : cutCodePoints(codeValue, 64),
      qty: formatDec(storedQty, 4),
      unitRaw: unitText === undefined ? null : clean(unitText) || null,
      unitPrice: formatDec(unitDec, 4),
      lineAmount: formatDec(amount, 4),
      vatRate: rate,
      vatNature: nature,
      xmlDetails: details,
    };
    if (Buffer.byteLength(JSON.stringify(details), "utf8") > XML_MAX_DETAILS_BYTES) {
      reader.refuse("line_details_too_large", lineNo);
      return;
    }
    const key = `${rate}|${nature ?? ""}`;
    lineSums.set(key, (lineSums.get(key) ?? 0n) + amount);
    lines.push(mapped);
  });

  // The legal amount per rate can differ from the line sums: one extra line, or a note.
  const notes = new Set<XmlNote>();
  summary.imponibile.forEach((taxable, key) => {
    const difference = taxable - (lineSums.get(key) ?? 0n);
    const [rate, natureText] = key.split("|") as [string, string];
    const nature = natureText === "" ? null : natureText;
    if (difference > HALF_CENT) {
      notes.add("rounding_line_added");
      lines.push({
        rawDescription: `Differenza dal riepilogo IVA ${rateLabel(rate, nature)}`,
        supplierCode: null,
        qty: "1.0000",
        unitRaw: null,
        unitPrice: formatDec(difference, 4),
        lineAmount: formatDec(difference, 4),
        vatRate: rate,
        vatNature: nature,
        xmlDetails: {
          lineNumber: null,
          kind: "residual",
          codes: [],
          otherData: [],
          discounts: [],
          listUnitPrice: null,
          periodStart: null,
          periodEnd: null,
        },
      });
    } else if (difference < -HALF_CENT) {
      notes.add("riepilogo_negative_residual");
    }
  });
  if (skipped > 0) notes.add("text_lines_skipped");
  if (lines.length === 0) reader.invalid.add({ body: reader.body, field: "DettaglioLinee" });
  if (lines.length > XML_MAX_LINES) reader.refuse("too_many_lines");

  // Totals (D-X14).
  const grossDec = grossText === undefined ? summary.net + summary.vat : parseDec(grossText)!;
  if (grossDec < 0n) reader.refuse("negative_total");
  for (const total of [summary.net, summary.vat, grossDec]) {
    if (total > MAX_AMOUNT) reader.refuse("amount_out_of_range");
  }

  // Due date: the earliest instalment, else the reference date plus the terms.
  const payments = children(body, "DatiPagamento").flatMap((block) =>
    children(block, "DettaglioPagamento"),
  );
  const dueDates = payments
    .map((payment) =>
      reader.optional(payment, "DataScadenzaPagamento", s.isoDate, "DataScadenzaPagamento"),
    )
    .filter((value): value is string => value !== undefined);
  if (dueDates.length === 0) {
    for (const payment of payments) {
      const reference = reader.optional(
        payment,
        "DataRiferimentoTerminiPagamento",
        s.isoDate,
        "DataRiferimentoTerminiPagamento",
      );
      const days = reader.optional(
        payment,
        "GiorniTerminiPagamento",
        s.dayCount,
        "GiorniTerminiPagamento",
      );
      if (reference !== undefined && days !== undefined)
        dueDates.push(addDays(reference, Number(days)));
    }
  }
  const dueDate = dueDates.length === 0 ? null : [...dueDates].sort()[0]!;
  if (payments.length > 1) notes.add("instalments");

  // Blocks Costì does not import, said out loud (D-X15).
  if (child(body, "Allegati")) notes.add("attachments");
  if (child(child(body, "DatiGenerali"), "DatiDDT")) notes.add("ddt_refs");
  const generalData = child(body, "DatiGenerali");
  if (
    ["DatiOrdineAcquisto", "DatiContratto", "DatiConvenzione", "DatiRicezione"].some((name) =>
      child(generalData, name),
    )
  ) {
    notes.add("order_refs");
  }
  if (general && children(general, "ScontoMaggiorazione").length > 0)
    notes.add("document_discount");
  if (general && child(general, "DatiBollo")) notes.add("stamp_duty");
  if (child(body, "DatiVeicoli")) notes.add("vehicle_data");

  if (documentType === undefined || date === undefined || number === undefined) return null;
  const numberRaw = clean(number);
  return {
    documentType: documentType as MappedBody["documentType"],
    notes: XML_NOTES.filter((note) => notes.has(note)),
    header: {
      supplierVat: supplier.vat,
      supplierName: supplier.name,
      numberRaw,
      invoiceDate: date,
      dueDate,
      netTotal: formatDec(summary.net, 2),
      vatTotal: formatDec(summary.vat, 2),
      grossTotal: formatDec(grossDec, 2),
    },
    lines,
    vatSummary: summary.rows,
  };
}

/**
 * The invoices of a FatturaPA file, one per body. All or nothing: a FatturaError with up to five
 * reasons when anything is refused. FPR12 and FPA12 are read the same way.
 */
export function mapFattura(doc: XmlDocument): MappedFile {
  const header = child(doc.root, "FatturaElettronicaHeader");
  const bodies = children(doc.root, "FatturaElettronicaBody");
  if (!header || bodies.length === 0) {
    throw new FatturaError("xml_invalid_content", "invalid", [
      { field: header ? "FatturaElettronicaBody" : "FatturaElettronicaHeader" },
    ]);
  }
  refuseTooManyBodies(bodies.length);
  refuseUnsupportedDocumentTypes(bodies);
  refuseMissingGoods(bodies);

  const unsupported = new Reasons();
  bodies.forEach((body, index) => findUnsupportedContent(body, index + 1, unsupported));
  throwUnsupported(unsupported);

  const file: ParsedFile = { header, bodies };
  const invalid = new Reasons();
  const supplier = mapSupplier(file, invalid);
  const mapped: MappedBody[] = [];
  const numeric = new Reasons();
  bodies.forEach((body, index) => {
    const result = mapBody(
      new BodyReader(index + 1, invalid, numeric),
      body,
      supplier ?? { vat: "", name: "" },
    );
    if (result) mapped.push(result);
  });
  throwInvalid(invalid);
  throwUnsupported(numeric);
  return { format: doc.versione, buyer: mapBuyer(file), bodies: mapped };
}
