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
