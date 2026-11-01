// A small RFC 4180 writer with typed cells (M24 plan §3.1.3-§3.1.4, ADR-027; no CSV dependency, as for the reader in parse.ts).
// The house format is the Q170 default: ";" between columns, decimal comma, no thousands separator, UTF-8 with a BOM, CRLF after every row.
// Cells are typed so that formula escaping applies to text only: a number is written by a formatter whose output can only be -?\d+(,\d{1,4})?,
// so a negative amount stays a number. Unknown is an empty cell, never 0.

import { VENUE_TIME_ZONE } from "@/lib/time/format";

export const CSV_FORMAT = { separator: ";", decimal: ",", bom: "﻿", eol: "\r\n" } as const;

export type Cell =
  | { kind: "text"; value: string | null }
  | { kind: "number"; value: number | null }
  | { kind: "date"; value: string | null }
  | { kind: "instant"; value: string | null }
  | { kind: "bool"; value: boolean | null };

/** Constructors, so that a table definition reads `cell.number(row.qty)`. */
export const cell = {
  text: (value: string | null): Cell => ({ kind: "text", value }),
  number: (value: number | null): Cell => ({ kind: "number", value }),
  date: (value: string | null): Cell => ({ kind: "date", value }),
  instant: (value: string | null): Cell => ({ kind: "instant", value }),
  bool: (value: boolean | null): Cell => ({ kind: "bool", value }),
};

// = + - @ are the four characters of project plan §3.11.6; tab and CR are a defensive addition (ADR-027).
const FORMULA_START = /^[=+\-@\t\r]/;

/** A text that a spreadsheet could run as a formula gets a leading apostrophe. */
export function escapeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** The value at up to four decimals, trailing zeros dropped, with the decimal comma: 38.0002 -> "38,0002", -0 -> "0". */
export function formatCsvNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError("CSV number is not finite");
  if (Math.abs(n) >= 1e21) throw new RangeError("CSV number is too large");
  const fixed = n.toFixed(4).replace(/\.?0+$/, "");
  return (fixed === "-0" ? "0" : fixed).replace(".", CSV_FORMAT.decimal);
}

/** "2026-11-04" -> "04/11/2026". */
export function formatCsvDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError(`CSV date is not YYYY-MM-DD: ${JSON.stringify(isoDate)}`);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

const instantFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VENUE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-11-04T19:00:00Z" -> "04/11/2026 20:00" in Europe/Rome (DST through Intl). */
export function formatCsvInstant(iso: string): string {
  const date = new Date(iso);
  if (iso === "" || Number.isNaN(date.getTime())) {
    throw new RangeError(`CSV instant is not a date-time: ${JSON.stringify(iso)}`);
  }
  const p = Object.fromEntries(instantFormatter.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function render(c: Cell): { text: string; forceQuote: boolean } {
  if (c.value === null) return { text: "", forceQuote: false };
  switch (c.kind) {
    case "text": {
      const escaped = escapeFormula(c.value);
      return { text: escaped, forceQuote: escaped !== c.value };
    }
    case "number":
      return { text: formatCsvNumber(c.value), forceQuote: false };
    case "date":
      return { text: formatCsvDate(c.value), forceQuote: false };
    case "instant":
      return { text: formatCsvInstant(c.value), forceQuote: false };
    case "bool":
      return { text: c.value ? "sì" : "no", forceQuote: false };
  }
}

function field(text: string, forceQuote: boolean): string {
  const needsQuote = forceQuote || /[;"\r\n]/.test(text);
  return needsQuote ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The whole file: BOM, header row, then one CRLF-ended row per entry. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const out: string[] = [header.map((h) => field(h, false)).join(CSV_FORMAT.separator)];
  for (const row of rows) {
    if (row.length !== header.length) {
      throw new RangeError(`CSV row has ${row.length} cells, the header ${header.length}`);
    }
    out.push(
      row
        .map((c) => {
          const r = render(c);
          return field(r.text, r.forceQuote);
        })
        .join(CSV_FORMAT.separator),
    );
  }
  return CSV_FORMAT.bom + out.map((l) => l + CSV_FORMAT.eol).join("");
}
