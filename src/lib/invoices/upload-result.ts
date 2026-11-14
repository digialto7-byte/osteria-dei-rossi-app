import { z } from "zod";
import { detailList, detailObject, type ApiErrorBody } from "@/lib/api/client";
import { formatBytes } from "@/lib/format/bytes";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { duplicatePartnerLabel } from "@/lib/invoices/duplicate-view";
import { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate } from "@/lib/time/format";
import type { BadgeTone } from "@/components/ui";
import type { XmlUploadedInvoice } from "@/server/invoices/xml-upload";

// What the upload card says after "Carica" (P2-7). Pure: it chooses words and links from the reply, it computes nothing from it.
// The wording of a refusal is the server's (`error.message`); only the e-invoice size message, the per-place rows and the links are added here.

/** A name ending in .xml or .p7m: a hint for the screen only (the server reads the content). */
export const isEInvoiceName = (name: string): boolean => /\.(xml|p7m)$/i.test(name);

/** The "Fattura elettronica" chip under a picked file, or null for a PDF or a photo. */
export function eInvoiceChip(
  name: string | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return name && isEInvoiceName(name) ? t("invoices.eInvoice", {}, locale) : null;
}

/** The reply of POST /api/invoices: `invoices` is set only for an e-invoice file. */
export interface UploadReply {
  invoice: { id: string };
  invoices?: XmlUploadedInvoice[];
}

export interface UploadedRow {
  id: string;
  href: string;
  title: string;
  badge: { tone: BadgeTone; text: string };
}

export type UploadSuccess =
  | { kind: "document" }
  | { kind: "xml-one" | "xml-duplicate"; text: string; href: string; linkLabel: string }
  | { kind: "xml-many"; intro: string; rows: UploadedRow[] };

const reviewHref = (id: string) => `/fatture/${id}/revisione`;

function statusBadge(status: string, duplicate: boolean): UploadedRow["badge"] {
  if (duplicate) return { tone: "neutral", text: t("invoices.xml.looksUploaded") };
  const key = `invoiceStatus.${status}`;
  return { tone: "warning", text: isMessageKey(key) ? t(key as MessageKey) : status };
}

/** What the card shows for a successful upload: a plain note for a PDF or photo, one of three e-invoice forms otherwise. */
export function describeUploadSuccess(reply: UploadReply): UploadSuccess {
  const invoices = reply.invoices;
  if (!invoices || invoices.length === 0) return { kind: "document" };
  const label = (item: XmlUploadedInvoice) =>
    duplicatePartnerLabel({ number: item.number, date: item.invoiceDate });
  if (invoices.length === 1) {
    const only = invoices[0]!;
    if (only.duplicateOf !== null) {
      return {
        kind: "xml-duplicate",
        text: t("invoices.xml.readDuplicate", { partner: label(only) }),
        href: reviewHref(only.id),
        linkLabel: t("invoices.xml.open"),
      };
    }
    return {
      kind: "xml-one",
      text: t("invoices.xml.readOne", {
        number: only.number,
        date: formatCalendarDate(only.invoiceDate),
        supplier: only.supplierName.trim() || t("invoices.xml.noSupplierName"),
        amount: formatEuro(only.grossTotal),
      }),
      href: reviewHref(only.id),
      linkLabel: t("invoices.xml.reviewNow"),
    };
  }
  return {
    kind: "xml-many",
    intro: t("invoices.xml.many", { count: invoices.length }),
    rows: invoices.map((item) => ({
      id: item.id,
      href: reviewHref(item.id),
      title: t("invoices.xml.rowTitle", {
        partner: label(item),
        amount: formatEuro(item.grossTotal),
      }),
      badge: statusBadge(item.status, item.duplicateOf !== null),
    })),
  };
}

export interface UploadErrorView {
  /** A first sentence before the server's, or null. */
  lead: string | null;
  /** The server's sentence, or the e-invoice size sentence. */
  message: string;
  /** Up to five places in the file the refusal is about. */
  rows: string[];
  /** The invoice a repeated file is already stored as; the card links it. */
  openInvoiceId: string | null;
}

const MAX_ROWS = 5;
const invoiceIdDetails = z.object({ invoiceId: z.uuid() });

/** A field path of the file as a word (`DatiRiepilogo.AliquotaIVA` → "aliquota IVA"); a tag with no word is shown as the file wrote it. */
function fieldLabel(path: string): string {
  const name = path.split(".").pop() ?? path;
  const key = `invoices.xml.field.${name}`;
  return isMessageKey(key) ? t(key as MessageKey) : path;
}

type Detail = Record<string, string | number>;

function placeOf(detail: Detail): string | null {
  if (typeof detail.body !== "number") return null;
  return typeof detail.line === "number"
    ? t("invoices.xml.whereLine", { body: detail.body, line: detail.line })
    : t("invoices.xml.whereBody", { body: detail.body });
}

function rowOf(detail: Detail, withField: boolean): string | null {
  const where = placeOf(detail);
  const field = withField && typeof detail.field === "string" ? fieldLabel(detail.field) : null;
  if (where && field) return t("invoices.xml.problem", { where, field });
  return where ?? field;
}

/**
 * The refusal of an upload as the card shows it. `fileName` decides the wording of a 413 (an e-invoice is usually over the
 * limit because of an attached PDF). Nothing here invents a detail: a row exists only where the server sent one.
 */
export function describeUploadError(error: ApiErrorBody, fileName: string | null): UploadErrorView {
  const details = detailList(error.details) ?? [];
  const view: UploadErrorView = {
    lead: null,
    message: error.message,
    rows: [],
    openInvoiceId: null,
  };
  if (error.code === "payload_too_large" && fileName !== null && isEInvoiceName(fileName)) {
    view.message = t("invoices.tooBigXml", { max: formatBytes(MAX_UPLOAD_BYTES) });
  }
  if (error.code === "already_uploaded") {
    view.openInvoiceId = detailObject(error.details, invoiceIdDetails)?.invoiceId ?? null;
  }
  if (error.code === "xml_invalid_content" || error.code === "xml_content_unsupported") {
    const withField = error.code === "xml_invalid_content";
    view.rows = details
      .filter((detail) => withField || typeof detail.line === "number")
      .map((detail) => rowOf(detail, withField))
      .filter((row): row is string => row !== null)
      .slice(0, MAX_ROWS);
    // A refusal that names an invoice after the first: the owner must not think the others went in.
    if (details.some((detail) => typeof detail.body === "number" && detail.body > 1)) {
      view.lead = t("invoices.xml.noneSaved");
    }
  }
  return view;
}
