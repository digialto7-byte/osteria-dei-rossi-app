// A small RFC 4180 reader for our own import templates (M1 plan §4: no CSV dependency).
// Supports ";" or "," (detected from the header line), quoted fields with "" escapes and
// embedded newlines, CRLF or LF, a leading byte-order mark, and skips blank lines and rows
// that contain only delimiters.

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

/** One CSV record and the file line it starts on (for error messages). */
export interface CsvRecord {
  line: number;
  cells: string[];
}

export function parseCsv(input: string): string[][] {
  return parseCsvRecords(input).map((record) => record.cells);
}

export function parseCsvRecords(input: string): CsvRecord[] {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const delimiter = detectDelimiter(text);
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteStartLine = 0;
  let line = 1;
  let recordStartLine = 1;

  const endRow = () => {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) records.push({ line: recordStartLine, cells: row });
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
      recordStartLine = line;
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new CsvError(quoteStartLine);
  endRow();
  return records;
}
