import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, parseCsvRecords } from "@/lib/csv/parse";

describe("parseCsv", () => {
  it("reads semicolon-separated rows (Italian Excel default)", () => {
    expect(parseCsv("nome;partita_iva\nFornitore A;IT12345678903\n")).toEqual([
      ["nome", "partita_iva"],
      ["Fornitore A", "IT12345678903"],
    ]);
  });

  it("detects a comma delimiter from the header line", () => {
    expect(parseCsv("nome,unita_base\nFarina,kg")).toEqual([
      ["nome", "unita_base"],
      ["Farina", "kg"],
    ]);
  });

  it("keeps a delimiter inside quotes and unescapes doubled quotes", () => {
    expect(parseCsv('nome;note\n"Rossi; Figli";"detto ""il Rosso"""')).toEqual([
      ["nome", "note"],
      ["Rossi; Figli", 'detto "il Rosso"'],
    ]);
  });

  it("allows a newline inside a quoted field", () => {
    expect(parseCsv('a;b\n"riga 1\nriga 2";x')).toEqual([
      ["a", "b"],
      ["riga 1\nriga 2", "x"],
    ]);
  });

  it("strips a byte-order mark and handles CRLF", () => {
    expect(parseCsv("﻿a;b\r\n1;2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseCsv("a;b\n\n1;2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips rows that are only delimiters (Excel exports pad sheets with them)", () => {
    expect(parseCsv("a;b;c\n1;2;3\n;;\n ; ;\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("parseCsvRecords gives each record the file line it starts on", () => {
    expect(parseCsvRecords('a;b\n\n1;2\n;;\n"x\ny";3\n4;5').map((r) => r.line)).toEqual([
      1, 3, 5, 7,
    ]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv("a;b;c\n1;;3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("reports an unterminated quote with its line number", () => {
    expect(() => parseCsv('a;b\n1;2\n"aperta;3')).toThrow(CsvError);
    try {
      parseCsv('a;b\n1;2\n"aperta;3');
    } catch (error) {
      expect((error as CsvError).line).toBe(3);
    }
  });

  it("an empty file has no rows", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("﻿\n")).toEqual([]);
  });
});
