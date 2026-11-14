import { t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { duplicatePartnerLabel } from "@/lib/invoices/duplicate-view";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate } from "@/lib/time/format";
import { formatNumber } from "@/lib/units";
import type {
  InvoiceReview,
  ReviewInvoiceXml,
  ReviewLine,
  ReviewLineXml,
  ReviewVatRow,
} from "@/server/invoices/review-types";

// Presentation rules of the review screen for an XML e-invoice (P2-7 screen spec §5). Pure: they choose words and write figures the
// reply already holds (the server owns the notes' wording, the VAT summary and the amount comparison); nothing is computed from the reply.

/** The longest lot code the line accepts (the API's limit): a longer text from the file is shown but cannot be copied. */
const MAX_LOT_LENGTH = 64;

/** "Fattura elettronica · Fattura (TD01)": the server's label of the document type, then its code. */
export function headerChipText(xml: ReviewInvoiceXml, locale: Locale = DEFAULT_LOCALE): string {
  const type = t(
    "review.xml.docType",
    { label: xml.documentTypeLabel, code: xml.documentType },
    locale,
  );
  return t("review.xml.chip", { type }, locale);
}

/** Which invoice of the file this is, only when the file holds more than one. */
export function bodyPositionText(
  xml: ReviewInvoiceXml,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return xml.bodyCount > 1
    ? t("review.xml.bodyOf", { n: xml.bodyIndex, count: xml.bodyCount }, locale)
    : null;
}

/** A p7m was opened; its signature was not verified. */
export function signedText(xml: ReviewInvoiceXml, locale: Locale = DEFAULT_LOCALE): string | null {
  return xml.signed ? t("review.xml.signed", {}, locale) : null;
}

/** The accessible name of the download link: it says it downloads, and the type of file. */
export function downloadLabel(xml: ReviewInvoiceXml, locale: Locale = DEFAULT_LOCALE): string {
  return t(xml.signed ? "review.xml.downloadP7m" : "review.xml.downloadXml", {}, locale);
}

/**
 * One row of the file's VAT summary: "22% · imponibile 100,00 € · IVA 22,00 €", or for a nature "Esenti (N4) · imponibile 10,00 €"
 * (the server's label, then the code; the code alone when it has no label).
 */
export function vatRowText(row: ReviewVatRow, locale: Locale = DEFAULT_LOCALE): string {
  const taxable = formatEuro(row.taxable, locale);
  if (row.nature !== null) {
    const nature =
      row.natureLabel === null
        ? row.nature
        : t("review.xml.natureWithCode", { label: row.natureLabel, code: row.nature }, locale);
    return t("review.xml.vatNature", { nature, taxable }, locale);
  }
  return t(
    "review.xml.vatRate",
    { rate: `${formatNumber(row.rate, locale)}%`, taxable, tax: formatEuro(row.tax, locale) },
    locale,
  );
}

/** What kind of line the file marked it as ("Spesa accessoria", the residual line Costì added); null for an ordinary line. */
export function lineKindText(line: ReviewLine, locale: Locale = DEFAULT_LOCALE): string | null {
  const kind = line.xml?.kind ?? null;
  if (kind === null) return null;
  if (kind === "residual") {
    return t(
      "review.xml.kind.residual",
      { rate: line.vatRate === null ? "" : formatNumber(line.vatRate, locale) },
      locale,
    );
  }
  return t(`review.xml.kind.${kind}`, {}, locale);
}

/** "Cod. EAN 8000000000001": the first code of the file, the one Costì uses to recognise the item. */
export function lineCodeText(xml: ReviewLineXml, locale: Locale = DEFAULT_LOCALE): string | null {
  const first = xml.codes[0];
  return first ? t("review.xml.code", { type: first.type, value: first.value }, locale) : null;
}

/** "Prezzo 10,00 € − sconto 10%": the price before the discounts and each discount or surcharge as the file wrote it. */
export function lineDiscountText(
  xml: ReviewLineXml,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const parts = xml.discounts.flatMap((item) => {
    const value =
      item.percent !== null
        ? `${formatNumber(item.percent, locale)}%`
        : item.amount !== null
          ? formatEuro(item.amount, locale)
          : null;
    return value === null
      ? []
      : [t(item.type === "MG" ? "review.xml.surcharge" : "review.xml.discount", { value }, locale)];
  });
  if (parts.length === 0) return null;
  const discounts = parts.join(" − ");
  return xml.listUnitPrice === null
    ? t("review.xml.discountsOnly", { discounts }, locale)
    : t(
        "review.xml.priceWithDiscounts",
        { price: formatEuro(xml.listUnitPrice, locale), discounts },
        locale,
      );
}

/** One value of "Dal fornitore", as written, with what the owner can do with it. */
export interface OtherDataValue {
  key: string;
  /** The supplier's own label (`TipoDato`): Costì does not interpret it. */
  label: string;
  display: string;
  /** A text can become the lot, a date the expiry; a number nothing. */
  use: { kind: "lot"; value: string } | { kind: "expiry"; value: string } | null;
  /** A text longer than a lot code can be: no button, a short reason instead. */
  tooLong: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateDisplay(value: string, locale: Locale): { display: string; valid: boolean } {
  if (!ISO_DATE.test(value)) return { display: value, valid: false };
  try {
    return { display: formatCalendarDate(value, locale), valid: true };
  } catch {
    return { display: value, valid: false };
  }
}

export function otherDataValues(
  xml: ReviewLineXml,
  locale: Locale = DEFAULT_LOCALE,
): OtherDataValue[] {
  return xml.otherData.flatMap((item, index) => {
    const values: OtherDataValue[] = [];
    if (item.text !== null) {
      const tooLong = item.text.length > MAX_LOT_LENGTH;
      values.push({
        key: `${index}-text`,
        label: item.type,
        display: item.text,
        use: tooLong ? null : { kind: "lot", value: item.text },
        tooLong,
      });
    }
    if (item.number !== null) {
      values.push({
        key: `${index}-number`,
        label: item.type,
        display: formatNumber(item.number, locale),
        use: null,
        tooLong: false,
      });
    }
    if (item.date !== null) {
      const { display, valid } = dateDisplay(item.date, locale);
      values.push({
        key: `${index}-date`,
        label: item.type,
        display,
        use: valid ? { kind: "expiry", value: item.date } : null,
        tooLong: false,
      });
    }
    return values;
  });
}

/** A date of the reply as the venue writes it (a value that is not a real date is shown as it came). */
export const shownDate = (value: string, locale: Locale = DEFAULT_LOCALE): string =>
  dateDisplay(value, locale).display;

/** A supplier VAT number with a country code other than IT: `supplier.vat_number` takes Italian numbers only. */
export function isForeignVat(vat: string | null): boolean {
  return vat !== null && /^[A-Z]{2}/.test(vat) && !vat.startsWith("IT");
}

/** The duplicate area of an XML review (spec §5.5). The id is the case number of the spec's table. */
export interface DuplicateBannerView {
  id: 1 | 2 | 3 | 4;
  partnerId: string;
  text: string;
  partnerLabel: string;
  partnerHref: string;
  /** "Importi uguali." or the two totals in words; null when one total is missing. */
  amounts: string | null;
  /** The one primary action: replace the photo or PDF by the XML (case 1), or reject. */
  primary: "replace" | "reject";
  primaryLabel: string;
  /** "Non è un doppione" is offered. */
  canClear: boolean;
  /** The quiet reject button next to "replace" (case 1 only). */
  rejectLabel: string | null;
  note: string | null;
}

type BannerInput = Pick<InvoiceReview, "duplicatePartner" | "replaceWithXml"> & {
  invoice: Pick<InvoiceReview["invoice"], "status" | "xml" | "grossTotal">;
};

function amountsSentence(
  here: number | null,
  other: number | null,
  match: boolean | null,
  against: "other" | "approved",
  locale: Locale,
): string | null {
  if (match === true) return t("review.xml.amountsEqual", {}, locale);
  if (match === false && here !== null && other !== null) {
    return t(
      against === "approved" ? "review.xml.amountsDifferApproved" : "review.xml.amountsDifferOther",
      { here: formatEuro(here, locale), other: formatEuro(other, locale) },
      locale,
    );
  }
  return null;
}

/**
 * Which of the four banners the review shows, or null when the generic duplicate area stays: two photos or PDFs, an XML whose
 * look-alike photo cannot be replaced (not in review, not approved), or no look-alike at all.
 */
export function duplicateBanner(
  review: BannerInput,
  locale: Locale = DEFAULT_LOCALE,
): DuplicateBannerView | null {
  const { invoice, duplicatePartner: partner } = review;
  if (!partner || (invoice.status !== "review" && invoice.status !== "duplicate")) return null;
  const isXml = invoice.xml !== null;
  const base = {
    partnerId: partner.id,
    partnerLabel: duplicatePartnerLabel(partner, locale),
    partnerHref: `/fatture/${partner.id}`,
    note: null,
    rejectLabel: null,
  };
  const amounts = (against: "other" | "approved") =>
    amountsSentence(invoice.grossTotal, partner.grossTotal, partner.amountsMatch, against, locale);
  const rejectOnly = (labelKey: MessageKey) => ({
    primary: "reject" as const,
    primaryLabel: t(labelKey, {}, locale),
  });
  if (isXml && partner.format === "document") {
    if (review.replaceWithXml && partner.status === "review") {
      return {
        ...base,
        id: 1,
        text: t("review.xml.banner.replaceable", {}, locale),
        amounts: amounts("other"),
        primary: "replace",
        primaryLabel: t("review.xml.useXml", {}, locale),
        canClear: true,
        rejectLabel: t("review.xml.rejectFile", {}, locale),
      };
    }
    if (partner.status === "approved") {
      return {
        ...base,
        id: 2,
        text: t("review.xml.banner.approved", {}, locale),
        amounts: amounts("approved"),
        ...rejectOnly("review.xml.rejectFile"),
        canClear: false,
        note: t("review.xml.rejectKept", {}, locale),
      };
    }
    return null;
  }
  if (!isXml && partner.format === "xml") {
    return {
      ...base,
      id: 3,
      text: t("review.xml.banner.xmlOfDocument", {}, locale),
      amounts: amounts("other"),
      ...rejectOnly("review.xml.rejectCopy"),
      canClear: true,
    };
  }
  if (isXml && partner.format === "xml") {
    return {
      ...base,
      id: 4,
      text: t("review.xml.banner.xmlOfXml", {}, locale),
      amounts: amounts("other"),
      ...rejectOnly("review.xml.reject"),
      canClear: true,
    };
  }
  return null;
}
