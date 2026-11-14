/**
 * Limits of the e-invoice reader. Each is pinned by a test, and the SQL twins (bodies, lines) by a
 * parity test that reads the migration text.
 */

import { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";

/** DER/BER reader (p7m envelope). */
export const CMS_MAX_DEPTH = 16;
export const CMS_MAX_TLVS = 10_000;
/** A definite length is written in at most this many bytes (up to 4 GiB, then bounded by the input). */
export const CMS_MAX_LENGTH_BYTES = 4;
/** A p7m inside a p7m (parallel signatures produce .p7m.p7m): the outer one is level 1. */
export const CMS_MAX_ENVELOPES = 3;

/** XML reader. The input limit is the upload limit (4 MiB). */
export const XML_MAX_BYTES = MAX_UPLOAD_BYTES;
export const XML_MAX_DEPTH = 32;
export const XML_MAX_ELEMENTS = 200_000;
export const XML_MAX_ATTRIBUTES = 32;
/** Characters of text in one node, or of one attribute value (not counted inside Allegati and signatures). */
export const XML_MAX_TEXT_CHARS = 10_000;

export const NS_FATTURA = "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2";
export const NS_FATTURA_SEMPLIFICATA =
  "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.0";
export const NS_XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
export const XML_FORMATS = ["FPR12", "FPA12"] as const;

/** Import limits and lists. Twins of app.xml_* in supabase/migrations/20261204100300_import_xml_invoices.sql (a parity test reads that text). */
export const XML_MAX_BODIES = 10;
export const XML_MAX_LINES = 200;
/** An explicit allow-list: ordinary and deferred invoices. Every other TipoDocumento is refused. */
export const XML_DOCUMENT_TYPES = ["TD01", "TD24", "TD25"] as const;
export const XML_NOTES = [
  "attachments",
  "ddt_refs",
  "order_refs",
  "text_lines_skipped",
  "rounding_line_added",
  "riepilogo_negative_residual",
  "document_discount",
  "stamp_duty",
  "instalments",
  "buyer_unchecked",
  "vehicle_data",
] as const;
export const XML_NATURES = [
  "N1",
  "N2.1",
  "N2.2",
  "N3.1",
  "N3.2",
  "N3.3",
  "N3.4",
  "N3.5",
  "N3.6",
  "N4",
  "N5",
  "N6.1",
  "N6.2",
  "N6.3",
  "N6.4",
  "N6.5",
  "N6.6",
  "N6.7",
  "N6.8",
  "N6.9",
  "N7",
] as const;

/** Column ranges the import payload must respect (SQL: invoice_totals_ck, qty, line and unit price checks). */
export const XML_MAX_AMOUNT = "10000000";
export const XML_MAX_QTY_EXCLUSIVE = "100000000";
/** jsonb of xml_details is capped at 16 384 bytes in SQL; the JSON text stays well under it (measured: 7 250 bytes of text for 125 small items is 7 664 bytes of jsonb). */
export const XML_MAX_DETAILS_BYTES = 6_000;
/** Reasons listed in a refusal at most this many times. */
export const XML_MAX_DETAILS = 5;
export const XML_MAX_DESCRIPTION_CHARS = 500;
