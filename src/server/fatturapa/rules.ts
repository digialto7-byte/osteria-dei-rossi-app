/**
 * What Costì refuses, with the reason (plan section 3.3.4). A refusal is all or nothing for the
 * file; a list of reasons is capped at XML_MAX_DETAILS and holds codes, field names and line
 * numbers only, never the file's text.
 */
import { XML_DOCUMENT_TYPES, XML_MAX_BODIES, XML_MAX_DETAILS } from "@/server/fatturapa/constants";
import { FatturaError, type FatturaErrorDetail } from "@/server/fatturapa/errors";
import { UNKNOWN_DOCUMENT_TYPE_LABEL, documentTypeLabel } from "@/server/fatturapa/labels";
import { child, children, onlyChild, textOf, type XmlNode } from "@/server/fatturapa/xml";

const DOCUMENT_TYPE_CODE = /^TD\d{2}$/;

/** A bounded list of reasons. */
export class Reasons {
  private readonly items: FatturaErrorDetail[] = [];
  private total = 0;

  add(detail: FatturaErrorDetail): void {
    this.total += 1;
    if (this.items.length < XML_MAX_DETAILS) this.items.push(detail);
  }

  get list(): readonly FatturaErrorDetail[] {
    return this.items;
  }

  get any(): boolean {
    return this.total > 0;
  }
}

export const isAllowedDocumentType = (code: string): boolean =>
  (XML_DOCUMENT_TYPES as readonly string[]).includes(code);

export function documentTypeOf(body: XmlNode): string | undefined {
  return textOf(
    onlyChild(onlyChild(body, "DatiGenerali"), "DatiGeneraliDocumento"),
    "TipoDocumento",
  );
}

export function refuseTooManyBodies(count: number): void {
  if (count > XML_MAX_BODIES) {
    throw new FatturaError("xml_content_unsupported", "too_many_bodies", [
      { reason: "too_many_bodies" },
    ]);
  }
}

/** The explicit allow-list (TD01, TD24, TD25): any other TipoDocumento is refused with its code and label. */
export function refuseUnsupportedDocumentTypes(bodies: readonly XmlNode[]): void {
  const reasons = new Reasons();
  bodies.forEach((body, index) => {
    const code = documentTypeOf(body);
    if (code !== undefined && !isAllowedDocumentType(code)) {
      // Only a well-formed code is echoed: the raw text is the file's and can be up to 10 000 characters.
      reasons.add(
        DOCUMENT_TYPE_CODE.test(code)
          ? { body: index + 1, code, label: documentTypeLabel(code) }
          : { body: index + 1, label: UNKNOWN_DOCUMENT_TYPE_LABEL },
      );
    }
  });
  if (reasons.any)
    throw new FatturaError("xml_document_type_unsupported", "document_type", reasons.list);
}

/** A body without its DatiBeniServizi wrapper is not read at all: the checks below look only inside it. */
export function refuseMissingGoods(bodies: readonly XmlNode[]): void {
  const reasons = new Reasons();
  bodies.forEach((body, index) => {
    if (!onlyChild(body, "DatiBeniServizi"))
      reasons.add({ body: index + 1, field: "DatiBeniServizi" });
  });
  throwInvalid(reasons);
}

/** Content Costì does not handle, found by presence before any strict validation: currency, withholding, split payment. */
export function findUnsupportedContent(body: XmlNode, bodyIndex: number, reasons: Reasons): void {
  const general = onlyChild(onlyChild(body, "DatiGenerali"), "DatiGeneraliDocumento");
  const divisa = textOf(general, "Divisa");
  if (divisa !== undefined && divisa !== "EUR")
    reasons.add({ body: bodyIndex, reason: "currency" });
  if (general && (child(general, "DatiRitenuta") || child(general, "DatiCassaPrevidenziale"))) {
    reasons.add({ body: bodyIndex, reason: "withholding" });
  }
  const goods = onlyChild(body, "DatiBeniServizi");
  if (!goods) throw new Error("findUnsupportedContent needs refuseMissingGoods first");
  children(goods, "DettaglioLinee").forEach((line, index) => {
    if (textOf(line, "Ritenuta") === "SI") {
      const number = Number(textOf(line, "NumeroLinea"));
      reasons.add({
        body: bodyIndex,
        line: Number.isInteger(number) && number > 0 ? number : index + 1,
        reason: "withholding",
      });
    }
  });
  if (children(goods, "DatiRiepilogo").some((row) => textOf(row, "EsigibilitaIVA") === "S")) {
    reasons.add({ body: bodyIndex, reason: "split_payment" });
  }
}

export function throwUnsupported(reasons: Reasons): void {
  if (reasons.any) {
    throw new FatturaError(
      "xml_content_unsupported",
      reasons.list[0]?.reason ?? "unsupported",
      reasons.list,
    );
  }
}

export function throwInvalid(reasons: Reasons): void {
  if (reasons.any) {
    throw new FatturaError("xml_invalid_content", "invalid", reasons.list);
  }
}
