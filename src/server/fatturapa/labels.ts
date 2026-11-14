/** Italian labels for the codes of a FatturaPA file (Allegato A, TipoDocumento and Natura). Draft wording, "da approvare". */

export const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  TD01: "Fattura",
  TD02: "Acconto o anticipo su fattura",
  TD03: "Acconto o anticipo su parcella",
  TD04: "Nota di credito",
  TD05: "Nota di debito",
  TD06: "Parcella",
  TD07: "Fattura semplificata",
  TD08: "Nota di credito semplificata",
  TD09: "Nota di debito semplificata",
  TD16: "Integrazione fattura da reverse charge interno",
  TD17: "Integrazione o autofattura per acquisto di servizi dall'estero",
  TD18: "Integrazione per acquisto di beni intracomunitari",
  TD19: "Integrazione o autofattura per acquisto di beni ex art. 17 c. 2 DPR 633/72",
  TD20: "Autofattura per regolarizzazione e integrazione delle fatture",
  TD21: "Autofattura per splafonamento",
  TD22: "Estrazione di beni da Deposito IVA",
  TD23: "Estrazione di beni da Deposito IVA con versamento dell'IVA",
  TD24: "Fattura differita (art. 21 c. 4 lett. a)",
  TD25: "Fattura differita (art. 21 c. 4 terzo periodo lett. b)",
  TD26: "Cessione di beni ammortizzabili e passaggi interni",
  TD27: "Fattura per autoconsumo o cessioni gratuite senza rivalsa",
  TD28: "Acquisti da San Marino con IVA",
  TD29: "Comunicazione per omessa o irregolare fatturazione",
};

export const UNKNOWN_DOCUMENT_TYPE_LABEL = "Tipo di documento non riconosciuto";

export function documentTypeLabel(code: string): string {
  return DOCUMENT_TYPE_LABELS[code] ?? UNKNOWN_DOCUMENT_TYPE_LABEL;
}

export const NATURE_LABELS: Readonly<Record<string, string>> = {
  N1: "Escluse ex art. 15",
  "N2.1": "Non soggette, artt. da 7 a 7-septies DPR 633/72",
  "N2.2": "Non soggette, altri casi",
  "N3.1": "Non imponibili, esportazioni",
  "N3.2": "Non imponibili, cessioni intracomunitarie",
  "N3.3": "Non imponibili, cessioni verso San Marino",
  "N3.4": "Non imponibili, operazioni assimilate alle esportazioni",
  "N3.5": "Non imponibili, dichiarazioni d'intento",
  "N3.6": "Non imponibili, altre operazioni senza plafond",
  N4: "Esenti",
  N5: "Regime del margine, IVA non esposta",
  "N6.1": "Inversione contabile, rottami e materiali di recupero",
  "N6.2": "Inversione contabile, oro e argento",
  "N6.3": "Inversione contabile, subappalto edile",
  "N6.4": "Inversione contabile, cessione di fabbricati",
  "N6.5": "Inversione contabile, telefoni cellulari",
  "N6.6": "Inversione contabile, prodotti elettronici",
  "N6.7": "Inversione contabile, comparto edile e settori connessi",
  "N6.8": "Inversione contabile, settore energetico",
  "N6.9": "Inversione contabile, altri casi",
  N7: "IVA assolta in altro Stato UE",
};

export function natureLabel(code: string): string {
  return NATURE_LABELS[code] ?? code;
}
