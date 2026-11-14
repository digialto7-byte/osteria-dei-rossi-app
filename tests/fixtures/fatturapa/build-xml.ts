// Test-only helpers that build small FatturaPA-shaped XML (fake data, no client facts).

export const NS_FPR = "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2";
export const NS_SEMPLIFICATA = "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.0";
export const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";

export const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** A root element in the FatturaPA namespace with an optional prefix, around `inner`. */
export function root(
  inner: string,
  options: { prefix?: string | null; versione?: string; extraAttrs?: string } = {},
): string {
  const { prefix = "p", versione = "FPR12", extraAttrs = "" } = options;
  const name = prefix ? `${prefix}:FatturaElettronica` : "FatturaElettronica";
  const xmlns = prefix ? `xmlns:${prefix}="${NS_FPR}"` : `xmlns="${NS_FPR}"`;
  return `${DECLARATION}\n<${name} ${xmlns} versione="${versione}"${extraAttrs ? ` ${extraAttrs}` : ""}>${inner}</${name}>`;
}

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** `levels` nested <a> elements. */
export const nested = (levels: number): string => "<a>".repeat(levels) + "</a>".repeat(levels);

// ---- A FatturaPA builder (FPR12 shape, official element order). All values are fake. ----

export interface LineSpec {
  n?: number | null;
  kind?: string;
  codes?: [string, string][];
  desc?: string;
  qty?: string | null;
  unit?: string;
  unitPrice?: string;
  discounts?: { tipo: string; perc?: string; importo?: string }[];
  total?: string;
  rate?: string;
  natura?: string;
  ritenuta?: string;
  other?: { tipo: string; testo?: string; numero?: string; data?: string }[];
  start?: string;
  end?: string;
}

export interface SummarySpec {
  rate: string;
  natura?: string;
  spese?: string;
  arrot?: string;
  imponibile: string;
  imposta: string;
  esig?: string;
  rif?: string;
}

export interface BodySpec {
  td?: string;
  divisa?: string;
  date?: string;
  numero?: string | null;
  totale?: string | null;
  docExtra?: string;
  generalExtra?: string;
  lines?: LineSpec[];
  summary?: SummarySpec[];
  payments?: string;
  bodyExtra?: string;
}

export interface FileSpec {
  supplierVat?: string;
  supplierCountry?: string;
  supplierName?: string | null;
  buyerVat?: string | null;
  buyerCf?: string;
  bodies?: BodySpec[];
  prefix?: string | null;
  versione?: string;
  headerExtra?: string;
}

const tag = (name: string, value: string | undefined | null): string =>
  value === undefined || value === null ? "" : `<${name}>${value}</${name}>`;

function lineXml(line: LineSpec, index: number): string {
  const n = line.n === undefined ? index + 1 : line.n;
  return (
    "<DettaglioLinee>" +
    tag("NumeroLinea", n === null ? undefined : String(n)) +
    tag("TipoCessionePrestazione", line.kind) +
    (line.codes ?? [])
      .map(
        ([t, v]) =>
          `<CodiceArticolo>${tag("CodiceTipo", t)}${tag("CodiceValore", v)}</CodiceArticolo>`,
      )
      .join("") +
    tag("Descrizione", line.desc ?? "Prodotto demo") +
    tag("Quantita", line.qty === undefined ? "1.00" : line.qty) +
    tag("UnitaMisura", line.unit) +
    tag("DataInizioPeriodo", line.start) +
    tag("DataFinePeriodo", line.end) +
    tag("PrezzoUnitario", line.unitPrice ?? "10.00") +
    (line.discounts ?? [])
      .map(
        (d) =>
          `<ScontoMaggiorazione>${tag("Tipo", d.tipo)}${tag("Percentuale", d.perc)}${tag("Importo", d.importo)}</ScontoMaggiorazione>`,
      )
      .join("") +
    tag("PrezzoTotale", line.total ?? "10.00") +
    tag("AliquotaIVA", line.rate ?? "22.00") +
    tag("Ritenuta", line.ritenuta) +
    tag("Natura", line.natura) +
    (line.other ?? [])
      .map(
        (o) =>
          `<AltriDatiGestionali>${tag("TipoDato", o.tipo)}${tag("RiferimentoTesto", o.testo)}${tag("RiferimentoNumero", o.numero)}${tag("RiferimentoData", o.data)}</AltriDatiGestionali>`,
      )
      .join("") +
    "</DettaglioLinee>"
  );
}

function summaryXml(row: SummarySpec): string {
  return (
    "<DatiRiepilogo>" +
    tag("AliquotaIVA", row.rate) +
    tag("Natura", row.natura) +
    tag("SpeseAccessorie", row.spese) +
    tag("Arrotondamento", row.arrot) +
    tag("ImponibileImporto", row.imponibile) +
    tag("Imposta", row.imposta) +
    tag("EsigibilitaIVA", row.esig) +
    tag("RiferimentoNormativo", row.rif) +
    "</DatiRiepilogo>"
  );
}

export function bodyXml(body: BodySpec = {}): string {
  const lines = body.lines ?? [{}];
  const summary = body.summary ?? [{ rate: "22.00", imponibile: "10.00", imposta: "2.20" }];
  const totale = body.totale === undefined ? "12.20" : body.totale;
  return (
    "<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento>" +
    tag("TipoDocumento", body.td ?? "TD01") +
    tag("Divisa", body.divisa ?? "EUR") +
    tag("Data", body.date ?? "1998-11-03") +
    (body.numero === null ? "" : tag("Numero", body.numero ?? "FT 12")) +
    (body.docExtra ?? "") +
    tag("ImportoTotaleDocumento", totale) +
    "</DatiGeneraliDocumento>" +
    (body.generalExtra ?? "") +
    "</DatiGenerali><DatiBeniServizi>" +
    lines.map(lineXml).join("") +
    summary.map(summaryXml).join("") +
    "</DatiBeniServizi>" +
    (body.payments ?? "") +
    (body.bodyExtra ?? "") +
    "</FatturaElettronicaBody>"
  );
}

export function payment(
  ...details: { scadenza?: string; riferimento?: string; giorni?: string }[]
): string {
  return (
    "<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento>" +
    details
      .map(
        (d) =>
          `<DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento>${tag("DataRiferimentoTerminiPagamento", d.riferimento)}${tag("GiorniTerminiPagamento", d.giorni)}${tag("DataScadenzaPagamento", d.scadenza)}<ImportoPagamento>12.20</ImportoPagamento></DettaglioPagamento>`,
      )
      .join("") +
    "</DatiPagamento>"
  );
}

export function fileXml(spec: FileSpec = {}): string {
  const name = spec.supplierName === undefined ? "Fornitore Demo 1" : spec.supplierName;
  const buyerVat = spec.buyerVat === undefined ? "IT00000000000" : spec.buyerVat;
  const header =
    "<FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>00000000000</IdCodice></IdTrasmittente><ProgressivoInvio>1</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>0000000</CodiceDestinatario></DatiTrasmissione>" +
    `<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>${spec.supplierCountry ?? "IT"}</IdPaese><IdCodice>${(spec.supplierVat ?? "IT12345678903").slice(2)}</IdCodice></IdFiscaleIVA>` +
    `<Anagrafica>${name === null ? "" : name.startsWith("<") ? name : tag("Denominazione", name)}</Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici><Sede><Indirizzo>Via Demo 1</Indirizzo><CAP>00000</CAP><Comune>Demo</Comune><Nazione>IT</Nazione></Sede></CedentePrestatore>` +
    `<CessionarioCommittente><DatiAnagrafici>${buyerVat === null ? "" : `<IdFiscaleIVA><IdPaese>${buyerVat.slice(0, 2)}</IdPaese><IdCodice>${buyerVat.slice(2)}</IdCodice></IdFiscaleIVA>`}${tag("CodiceFiscale", spec.buyerCf)}<Anagrafica><Denominazione>Osteria Demo A</Denominazione></Anagrafica></DatiAnagrafici><Sede><Indirizzo>Via Demo 2</Indirizzo><CAP>00000</CAP><Comune>Demo</Comune><Nazione>IT</Nazione></Sede></CessionarioCommittente>` +
    (spec.headerExtra ?? "") +
    "</FatturaElettronicaHeader>";
  return root(header + (spec.bodies ?? [{}]).map(bodyXml).join(""), {
    prefix: spec.prefix === undefined ? "p" : spec.prefix,
    versione: spec.versione ?? "FPR12",
  });
}
