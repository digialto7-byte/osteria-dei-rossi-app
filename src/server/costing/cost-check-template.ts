import { ApiError, type ErrorDetail } from "@/lib/api/errors";
import { CsvError, parseCsvRecords } from "@/lib/csv/parse";
import { COST_CHECK_MAX_ROWS } from "./constants";
import type { SheetRow } from "./cost-check";

// The chef's sheet for Gate 1 (M8 plan §3.6): CSV `piatto;costo_cibo` (";" or ","), Italian headers,
// decimal comma or point, optional euro sign. Errors name the file row, the field and a code, never
// the contents of a cell.

export interface MappedSheet {
  rows: SheetRow[];
  errors: ErrorDetail[];
}

const NAME_COLUMN = "piatto";
const VALUE_COLUMN = "costo_cibo";
const FORMULA_START = /^[=+@]/;
const PLAIN = /^\d+(?:[.,]\d+)?$/;
const THOUSANDS = /^\d{1,3}(?:\.\d{3})+,\d+$/;
const MAX_REPORTED_ERRORS = 50;

function tooManyRows(): ApiError {
  return new ApiError(413, "payload_too_large", "Il foglio ha troppe righe.");
}

type Cell = { value: string } | { code: string };

function nameCell(text: string): Cell {
  const value = text.trim();
  if (value === "") return { code: "required" };
  if (FORMULA_START.test(value)) return { code: "invalid_value" };
  return { value };
}

function amountOf(text: string): number | { code: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { code: "required" };
  if (FORMULA_START.test(trimmed)) return { code: "invalid_value" };
  const cleaned = trimmed.replace(/€/g, "").replace(/\s/g, "");
  if (THOUSANDS.test(cleaned)) return Number(cleaned.replace(/\./g, "").replace(",", "."));
  if (PLAIN.test(cleaned)) return Number(cleaned.replace(",", "."));
  return { code: "invalid_value" };
}

function readRow(
  row: number,
  name: string,
  amount: string | number,
  errors: ErrorDetail[],
): SheetRow | null {
  const cell = nameCell(name);
  const value = typeof amount === "number" ? amount : amountOf(amount);
  let ok = true;
  if ("code" in cell) {
    errors.push({ row, field: NAME_COLUMN, code: cell.code });
    ok = false;
  }
  if (typeof value !== "number") {
    errors.push({ row, field: VALUE_COLUMN, code: value.code });
    ok = false;
  } else if (value < 0 || !Number.isFinite(value)) {
    errors.push({ row, field: VALUE_COLUMN, code: "invalid_value" });
    ok = false;
  }
  return ok && "value" in cell && typeof value === "number"
    ? { row, name: cell.value, sheetEur: value }
    : null;
}

export function costCheckRowsFromCsv(csv: string): MappedSheet {
  let records;
  try {
    records = parseCsvRecords(csv);
  } catch (error) {
    if (error instanceof CsvError) {
      return { rows: [], errors: [{ row: error.line, field: NAME_COLUMN, code: "malformed_csv" }] };
    }
    throw error;
  }
  const header = records[0];
  if (!header) return { rows: [], errors: [{ row: 1, field: "header", code: "missing_column" }] };

  const names = header.cells.map((cell) => cell.trim().toLowerCase());
  const nameAt = names.indexOf(NAME_COLUMN);
  const valueAt = names.indexOf(VALUE_COLUMN);
  const headerErrors: ErrorDetail[] = [];
  if (names.some((name) => name !== NAME_COLUMN && name !== VALUE_COLUMN)) {
    headerErrors.push({ row: header.line, field: "header", code: "unknown_column" });
  }
  if (nameAt < 0)
    headerErrors.push({ row: header.line, field: NAME_COLUMN, code: "missing_column" });
  if (valueAt < 0) {
    headerErrors.push({ row: header.line, field: VALUE_COLUMN, code: "missing_column" });
  }
  if (headerErrors.length > 0) return { rows: [], errors: headerErrors };

  const body = records.slice(1);
  if (body.length > COST_CHECK_MAX_ROWS) throw tooManyRows();
  const rows: SheetRow[] = [];
  const errors: ErrorDetail[] = [];
  for (const record of body) {
    const row = readRow(
      record.line,
      record.cells[nameAt] ?? "",
      record.cells[valueAt] ?? "",
      errors,
    );
    if (row) rows.push(row);
  }
  return { rows, errors: errors.slice(0, MAX_REPORTED_ERRORS) };
}

/** The JSON form: `[{name, foodCostEur}]`, rows numbered from 1 in array order. */
export function costCheckRowsFromJson(
  plates: readonly { name: string; foodCostEur: number }[],
): MappedSheet {
  if (plates.length > COST_CHECK_MAX_ROWS) throw tooManyRows();
  const rows: SheetRow[] = [];
  const errors: ErrorDetail[] = [];
  plates.forEach((plate, index) => {
    const row = readRow(index + 1, plate.name, plate.foodCostEur, errors);
    if (row) rows.push(row);
  });
  return { rows, errors: errors.slice(0, MAX_REPORTED_ERRORS) };
}
