/**
 * A refusal of an e-invoice file. It carries a stable code, a short reason key and optional
 * details made of codes and numbers only: never file content, names, VAT numbers or amounts, so
 * the message and the details are safe to log and to send to the client.
 */
export type FatturaErrorCode =
  | "xml_unreadable"
  | "xml_not_fatturapa"
  | "xml_simplified_unsupported"
  | "p7m_unreadable"
  | "xml_document_type_unsupported"
  | "xml_content_unsupported"
  | "xml_invalid_content";

export interface FatturaErrorDetail {
  body?: number;
  line?: number;
  field?: string;
  reason?: string;
  code?: string;
  label?: string;
}

export class FatturaError extends Error {
  readonly code: FatturaErrorCode;
  readonly reason: string;
  readonly details: readonly FatturaErrorDetail[];

  constructor(code: FatturaErrorCode, reason: string, details: readonly FatturaErrorDetail[] = []) {
    super(`${code}: ${reason}`);
    this.name = "FatturaError";
    this.code = code;
    this.reason = reason;
    this.details = details;
  }
}
