import { ApiError } from "@/lib/api/errors";
import type { FatturaError, FatturaErrorDetail } from "@/server/fatturapa/errors";

// What the owner can do about each refusal is in the text. Draft wording, "da approvare". The details carry codes,
// field names and line numbers only (never the file's text), so they can go to the screen as they are.
const UNSUPPORTED_REASON: Record<string, string> = {
  withholding: "Fattura con ritenuta d'acconto o cassa previdenziale: non ancora gestita.",
  currency: "Fattura in una valuta diversa dall'euro: non gestita.",
  negative_line:
    "Una riga ha un importo negativo (sconto o reso su una riga a parte): non ancora gestito.",
  negative_total: "La fattura ha un totale negativo: non ancora gestito.",
  split_payment: "Scissione dei pagamenti: riguarda solo la Pubblica Amministrazione.",
  too_many_lines: "La fattura ha più di 200 righe.",
  too_many_bodies: "Il file contiene più di 10 fatture: chiedi file separati.",
  amount_out_of_range: "Un importo o una quantità del file supera i limiti gestiti.",
  line_details_too_large: "Una riga del file ha troppi dati aggiuntivi per essere letta.",
};

function toDetails(details: readonly FatturaErrorDetail[]): Record<string, string | number>[] {
  return details.map(
    (detail) =>
      Object.fromEntries(
        Object.entries(detail).filter(([, value]) => value !== undefined),
      ) as Record<string, string | number>,
  );
}

/** A refusal of the file as an API error (422). Safe to show: no part of the file's text is in it. */
export function fatturaToApiError(error: FatturaError): ApiError {
  const details = toDetails(error.details);
  switch (error.code) {
    case "xml_unreadable":
      return new ApiError(
        422,
        "xml_unreadable",
        "Il file XML è danneggiato o non leggibile. Scaricalo di nuovo e riprova.",
      );
    case "xml_not_fatturapa":
      return new ApiError(
        422,
        "xml_not_fatturapa",
        "Questo file XML non è una fattura elettronica.",
      );
    case "xml_simplified_unsupported":
      return new ApiError(
        422,
        "xml_simplified_unsupported",
        "È una fattura semplificata: non ancora gestita. Carica il PDF o una foto.",
      );
    case "p7m_unreadable":
      return new ApiError(
        422,
        "p7m_unreadable",
        "Non riesco ad aprire il file firmato (.p7m). Prova a caricare la versione .xml della stessa fattura.",
      );
    case "xml_document_type_unsupported": {
      const first = error.details[0];
      const message =
        first?.code === "TD04"
          ? "È una nota di credito (TD04): Costì non la registra ancora. Passala al commercialista."
          : `Tipo di documento non gestito: ${first?.label ?? "sconosciuto"} (${first?.code ?? "?"}). Passalo al commercialista.`;
      return new ApiError(422, "xml_document_type_unsupported", message, details);
    }
    case "xml_content_unsupported":
      return new ApiError(
        422,
        "xml_content_unsupported",
        UNSUPPORTED_REASON[error.reason] ?? "Il file contiene dati non ancora gestiti.",
        details,
      );
    case "xml_invalid_content":
      return new ApiError(
        422,
        "xml_invalid_content",
        "Nel file mancano dati obbligatori o sono scritti male.",
        details,
      );
  }
}
