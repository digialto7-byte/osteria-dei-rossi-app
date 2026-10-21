// A small RFC 4180 reader for our own import templates (M1 plan §4: no CSV dependency).
// Supports ";" or "," (detected from the header line), quoted fields with "" escapes and
// embedded newlines, CRLF or LF, a leading byte-order mark, and skips blank lines.

export class CsvError extends Error {
  constructor(public readonly line: number) {
    super(`Unterminated quoted field starting on line ${line}`);
    this.name = "CsvError";
  }
}

const BOM = "﻿";
const QUOTE = '"';

function detectDelimiter(text: string): ";" | "," {
  const header = text.slice(0, text.search(/\r?\n|$/));
  const semicolons = header.split(";").length;
  const commas = header.split(",").length;
  return commas > semicolons ? "," : ";";
}

export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteStartLine = 0;
  let line = 1;

  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    field = "";
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === QUOTE && text[index + 1] === QUOTE) {
        field += QUOTE;
        index++;
      } else if (char === QUOTE) {
        inQuotes = false;
      } else {
        if (char === "\n") line++;
        field += char;
      }
    } else if (char === QUOTE && field === "") {
      inQuotes = true;
      quoteStartLine = line;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      endRow();
      line++;
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new CsvError(quoteStartLine);
  endRow();
  return rows;
}
