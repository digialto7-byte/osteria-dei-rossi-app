import { describe, expect, it } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import {
  CSV_FORMAT,
  cell,
  escapeFormula,
  formatCsvDate,
  formatCsvInstant,
  formatCsvNumber,
  toCsv,
  type Cell,
} from "@/lib/csv/write";

const BOM = "﻿";

/** The body lines of a CSV (without the BOM and the final CRLF). */
function lines(csv: string): string[] {
  return csv.replace(BOM, "").replace(/\r\n$/, "").split("\r\n");
}

describe("CSV_FORMAT (Q170 default)", () => {
  it("is the Italian Excel format", () => {
    expect(CSV_FORMAT).toEqual({ separator: ";", decimal: ",", bom: BOM, eol: "\r\n" });
  });
});

describe("escapeFormula (AT2)", () => {
  it.each([
    ["=SUM(A1)", "'=SUM(A1)"],
    ["+39 333 (demo)", "'+39 333 (demo)"],
    ["-Burro (demo)", "'-Burro (demo)"],
    ["@cmd", "'@cmd"],
    ["\tx", "'\tx"],
    ["\rx", "'\rx"],
    ["=1+1 (demo)", "'=1+1 (demo)"],
  ])("%j gets a leading apostrophe", (input, expected) => {
    expect(escapeFormula(input)).toBe(expected);
  });

  it.each(["Manzo", "", "Burro -salato", "a=b", " =x", "'=x", "1-2"])(
    "%j is unchanged",
    (input) => {
      expect(escapeFormula(input)).toBe(input);
    },
  );
});

describe("formatCsvNumber", () => {
  it.each([
    [-3.5, "-3,5"],
    [1234.5, "1234,5"],
    [38.0002, "38,0002"],
    [0.0001, "0,0001"],
    [22, "22"],
    [0, "0"],
    [-0, "0"],
    [1, "1"],
    [-1234567.8901, "-1234567,8901"],
    [10, "10"],
    [100, "100"],
    [0.5, "0,5"],
  ])("%s -> %s", (n, expected) => {
    expect(formatCsvNumber(n)).toBe(expected);
  });

  it.each([0.00001, -0.00001, 0.00004, 1.23456, 0.1 + 0.2, 38.00021])(
    "%s has more than four decimals: a RangeError, never a silent rounding",
    (n) => {
      expect(() => formatCsvNumber(n)).toThrow(RangeError);
    },
  );

  it.each([NaN, Infinity, -Infinity, 1e21])("%s throws a RangeError", (n) => {
    expect(() => formatCsvNumber(n)).toThrow(RangeError);
  });

  it("always matches ^-?\\d+(,\\d{1,4})?$ on a 200-value table with negatives", () => {
    // Deterministic pseudo-random values (no Math.random in unit tests).
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const values: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const sign = i % 2 === 0 ? -1 : 1;
      const magnitude = [1, 10, 1000, 100000][i % 4]!;
      values.push((sign * Math.round(next() * magnitude * 10000)) / 10000);
    }
    for (const v of values) {
      expect(formatCsvNumber(v)).toMatch(/^-?\d+(,\d{1,4})?$/);
    }
    expect(values.some((v) => v < 0)).toBe(true);
  });
});

describe("formatCsvDate", () => {
  it("writes GG/MM/AAAA", () => {
    expect(formatCsvDate("2026-11-04")).toBe("04/11/2026");
    expect(formatCsvDate("2027-01-31")).toBe("31/01/2027");
  });

  it.each(["", "2026-1-4", "04/11/2026", "2026-11-04T00:00:00Z"])("%j is refused", (input) => {
    expect(() => formatCsvDate(input)).toThrow(RangeError);
  });
});

describe("formatCsvInstant (Europe/Rome)", () => {
  it.each([
    ["2026-11-04T19:00:00Z", "04/11/2026 20:00"],
    ["2026-10-24T22:00:00Z", "25/10/2026 00:00"],
    ["2026-10-25T02:00:00Z", "25/10/2026 03:00"],
    ["2027-03-28T01:00:00Z", "28/03/2027 03:00"],
    ["2026-12-31T23:30:00Z", "01/01/2027 00:30"],
    ["2026-11-04T19:00:59.999+00:00", "04/11/2026 20:00"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatCsvInstant(iso)).toBe(expected);
  });

  it.each(["", "not a date", "2026-13-45T00:00:00Z"])("%j is refused", (input) => {
    expect(() => formatCsvInstant(input)).toThrow(RangeError);
  });
});

describe("toCsv", () => {
  it("starts with a BOM, ends every row with CRLF and has the header first", () => {
    const csv = toCsv(["a", "b"], [[cell.text("x"), cell.number(1)]]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(`${BOM}a;b\r\nx;1\r\n`);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(`${BOM}a;b`);
  });

  it("writes only the header for no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe(`${BOM}a;b\r\n`);
  });

  it("writes a text cell starting with - as an escaped, quoted field (AT2)", () => {
    const csv = toCsv(["nome"], [[cell.text("-Burro (demo)")], [cell.text("=1+1 (demo)")]]);
    expect(lines(csv)).toEqual(["nome", `"'-Burro (demo)"`, `"'=1+1 (demo)"`]);
  });

  it("never escapes numbers, so a negative stays a number", () => {
    const csv = toCsv(["n"], [[cell.number(-3.5)], [cell.number(1234.5)], [cell.number(38.0002)]]);
    expect(lines(csv)).toEqual(["n", "-3,5", "1234,5", "38,0002"]);
  });

  it("writes null as an empty cell for every kind, never 0", () => {
    const row: Cell[] = [
      cell.text(null),
      cell.number(null),
      cell.date(null),
      cell.instant(null),
      cell.bool(null),
    ];
    expect(lines(toCsv(["a", "b", "c", "d", "e"], [row]))[1]).toBe(";;;;");
  });

  it("writes an empty text as an empty cell", () => {
    expect(lines(toCsv(["a", "b"], [[cell.text(""), cell.text("x")]]))[1]).toBe(";x");
  });

  it("quotes a separator, a double quote and a line break", () => {
    const csv = toCsv(
      ["a"],
      [[cell.text("Pane; burro (demo)")], [cell.text('Il "Rosso" (demo)')], [cell.text("a\nb")]],
    );
    expect(csv).toBe(`${BOM}a\r\n"Pane; burro (demo)"\r\n"Il ""Rosso"" (demo)"\r\n"a\nb"\r\n`);
  });

  it("quotes a CR inside a field", () => {
    expect(toCsv(["a"], [[cell.text("a\rb")]])).toBe(`${BOM}a\r\n"a\rb"\r\n`);
  });

  it("does not quote a comma (the separator is a semicolon)", () => {
    expect(lines(toCsv(["a"], [[cell.text("burro, sale")]]))[1]).toBe("burro, sale");
  });

  it("writes dates, instants and booleans through their formatters", () => {
    const csv = toCsv(
      ["d", "i", "s", "n"],
      [
        [
          cell.date("2026-11-04"),
          cell.instant("2026-11-04T19:00:00Z"),
          cell.bool(true),
          cell.bool(false),
        ],
      ],
    );
    expect(lines(csv)[1]).toBe("04/11/2026;04/11/2026 20:00;sì;no");
  });

  it("refuses a row whose length differs from the header", () => {
    expect(() => toCsv(["a", "b"], [[cell.text("x")]])).toThrow(RangeError);
    expect(() => toCsv(["a"], [[cell.text("x"), cell.text("y")]])).toThrow(RangeError);
  });

  it("propagates a non-finite number as a RangeError", () => {
    expect(() => toCsv(["a"], [[cell.number(NaN)]])).toThrow(RangeError);
  });

  it("round trip: parseCsvRecords gives back the header and every cell as written", () => {
    const rows: Cell[][] = [
      [cell.text("=1+1 (demo)"), cell.number(-3.5), cell.date("2026-11-04"), cell.bool(true)],
      [cell.text("Pane; burro (demo)"), cell.number(38.0002), cell.date(null), cell.bool(false)],
      [cell.text('Il "Rosso" (demo)'), cell.number(null), cell.date("2026-10-25"), cell.bool(null)],
      [cell.text("a\nb"), cell.number(0), cell.date("2026-10-26"), cell.bool(true)],
      [cell.text("-Burro (demo)"), cell.number(1234.5), cell.date("2026-10-27"), cell.bool(true)],
    ];
    const records = parseCsvRecords(toCsv(["nome", "n", "d", "b"], rows));
    expect(records[0]!.cells).toEqual(["nome", "n", "d", "b"]);
    expect(records.slice(1).map((r) => r.cells)).toEqual([
      ["'=1+1 (demo)", "-3,5", "04/11/2026", "sì"],
      ["Pane; burro (demo)", "38,0002", "", "no"],
      ['Il "Rosso" (demo)', "", "25/10/2026", ""],
      ["a\nb", "0", "26/10/2026", "sì"],
      ["'-Burro (demo)", "1234,5", "27/10/2026", "sì"],
    ]);
  });
});
