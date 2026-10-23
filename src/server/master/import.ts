import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError, type ErrorDetail } from "@/lib/api/errors";
import { CsvError, parseCsvRecords, type CsvRecord } from "@/lib/csv/parse";
import { BASE_UNITS, type BaseUnit } from "@/lib/units";
import { isValidItVat, normaliseItVat } from "@/lib/vat/it-vat";
import { mapDbError } from "./db-errors";
import { ALLERGENS, type Allergen } from "./ingredients";

/** Every row-error code the import can report (each has an importError.* text in the UI). */
export const IMPORT_ERROR_CODES = [
  "required",
  "too_long",
  "invalid_vat_number",
  "invalid_number",
  "invalid_unit",
  "invalid_boolean",
  "invalid_allergen",
  "duplicate_in_file",
  "unknown_column",
  "invalid_value",
  "missing_column",
  "unterminated_quote",
  "ambiguous_match",
  "base_unit_conflict",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_CHARS = 512_000;
// UTF-8 needs at most 4 bytes per character, plus JSON escaping overhead.
export const MAX_IMPORT_BODY_BYTES = MAX_IMPORT_CHARS * 4 + 16_384;
const MAX_REPORTED_ERRORS = 50;
const HEADER_LINE = 1;
const MAX_NAME_LENGTH = { supplier: 200, ingredient: 120 } as const;
const MAX_CATEGORY_LENGTH = 60;
const ALLERGEN_SEPARATOR = "|";
// Founder decision Q5: a blank cell keeps the stored value on re-import; this mark clears it.
const CLEAR_MARK = "-";
// Allergen cell word for "declared: no allergen" (a blank cell means "not stated").
const NONE_WORD = "nessuno";
const TRUE_WORDS = new Set(["si", "sì", "s", "yes", "true", "1"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0"]);

export interface ImportCounts {
  created: number;
  updated: number;
  unchanged: number;
}

// An optional key that is absent keeps the stored value (a new row gets the column default);
// present, it sets the value, null meaning cleared.
export interface SupplierImportRow {
  row: number;
  name: string;
  vat_number: string | null;
  payment_terms_days?: number | null;
}

export interface IngredientImportRow {
  row: number;
  name: string;
  base_unit: BaseUnit;
  category?: string | null;
  is_stock?: boolean;
  allergens?: Allergen[] | null;
  default_shelf_life_days?: number | null;
}

interface Mapped<Row> {
  rows: Row[];
  errors: ErrorDetail[];
}

/** One input record with its file line; values are raw CSV text or raw JSON values. */
interface RawRecord {
  line: number;
  values: Record<string, unknown>;
}

// The template columns (Italian headers) and the JSON keys that mean the same thing.
const SUPPLIER_FIELDS = {
  nome: "name",
  partita_iva: "vatNumber",
  giorni_pagamento: "paymentTermsDays",
};
const INGREDIENT_FIELDS = {
  nome: "name",
  unita_base: "baseUnit",
  categoria: "category",
  a_magazzino: "isStock",
  allergeni: "allergens",
  giorni_conservazione: "defaultShelfLifeDays",
};

class RowErrors {
  readonly list: ErrorDetail[] = [];
  add(row: number, field: string, code: ImportErrorCode) {
    if (this.list.length < MAX_REPORTED_ERRORS) this.list.push({ row, field, code });
  }
}

const isBlank = (value: unknown) =>
  value === undefined || value === null || String(value).trim() === "";
const text = (value: unknown) => (isBlank(value) ? null : String(value).trim());
// JSON null says "clear" as plainly as the mark does; a blank cell or a missing key says "keep".
const isClear = (value: unknown) => value === null || String(value).trim() === CLEAR_MARK;

/** A value every row must have: blank and the clear mark are both missing. */
const requiredText = (value: unknown) => (isClear(value) ? null : text(value));

/** undefined: blank, keep the stored value; null: cleared on purpose; else the trimmed text. */
function optionalText(value: unknown): string | null | undefined {
  if (isClear(value)) return null;
  return isBlank(value) ? undefined : String(value).trim();
}

function wholeNumber(
  value: unknown,
  min: number,
  max: number,
): number | null | undefined | "invalid" {
  if (isClear(value)) return null;
  if (isBlank(value)) return undefined;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(number) && number >= min && number <= max ? number : "invalid";
}

/** Adds only the keys that have a value: absent keys tell the import to keep what is stored. */
function withoutBlanks<Row extends object>(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as Row;
}

function readCsv(csv: string, fields: Record<string, string>, errors: RowErrors): RawRecord[] {
  let table: CsvRecord[];
  try {
    table = parseCsvRecords(csv);
  } catch (error) {
    if (error instanceof CsvError) {
      errors.add(error.line, "(file)", "unterminated_quote");
      return [];
    }
    throw error;
  }
  const [header, ...data] = table;
  const headerLine = header?.line ?? HEADER_LINE;
  const columns = (header?.cells ?? []).map((name) => name.trim().toLowerCase());
  for (const column of columns) {
    if (!(column in fields)) errors.add(headerLine, column, "unknown_column");
  }
  if (!columns.includes("nome")) errors.add(headerLine, "nome", "missing_column");
  if (errors.list.length > 0) return [];
  // Row numbers in error details are file lines, so they match what the user sees in the file.
  return data.map(({ line, cells }) => ({
    line,
    values: Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? ""])),
  }));
}

/** JSON rows use the API's camelCase keys; they are renamed to the template columns. */
function readJson(
  rows: Record<string, unknown>[],
  fields: Record<string, string>,
  errors: RowErrors,
): RawRecord[] {
  const columnByKey = Object.fromEntries(
    Object.entries(fields).map(([column, key]) => [key, column]),
  );
  return rows.map((row, index) => {
    const line = index + 1;
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const column = columnByKey[key];
      if (!column) errors.add(line, key, "unknown_column");
      // Only allergens hold a list; anything else must be one plain value.
      else if (column !== "allergeni" && typeof value === "object" && value !== null) {
        errors.add(line, column, "invalid_value");
      } else values[column] = value;
    }
    return { line, values };
  });
}

function mapSuppliers(records: RawRecord[], errors: RowErrors): SupplierImportRow[] {
  const seen = new Set<string>();
  const rows: SupplierImportRow[] = [];
  for (const { line, values } of records) {
    const before = errors.list.length;
    const name = requiredText(values.nome);
    if (!name) errors.add(line, "nome", "required");
    else if (name.length > MAX_NAME_LENGTH.supplier) errors.add(line, "nome", "too_long");

    // The VAT number identifies the supplier rather than being updated, so blank and "-" agree.
    const rawVat = optionalText(values.partita_iva) ?? null;
    const vat = rawVat === null ? null : normaliseItVat(rawVat);
    if (vat !== null && !isValidItVat(vat)) errors.add(line, "partita_iva", "invalid_vat_number");

    const terms = wholeNumber(values.giorni_pagamento, 0, 365);
    if (terms === "invalid") errors.add(line, "giorni_pagamento", "invalid_number");

    // The same key twice in one file would make the result depend on row order.
    const key = vat ?? (name ? `name:${name.toLowerCase().replace(/\s+/g, " ")}` : "");
    if (errors.list.length === before && key) {
      if (seen.has(key)) errors.add(line, vat ? "partita_iva" : "nome", "duplicate_in_file");
      seen.add(key);
    }
    if (errors.list.length === before && name && terms !== "invalid") {
      rows.push(withoutBlanks({ row: line, name, vat_number: vat, payment_terms_days: terms }));
    }
  }
  return rows;
}

function parseBoolean(value: unknown): boolean | undefined | "invalid" {
  if (isClear(value)) return "invalid";
  if (isBlank(value)) return undefined;
  if (typeof value === "boolean") return value;
  const word = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  return "invalid";
}

/**
 * undefined: blank, keep the stored value (a new ingredient is "not stated"); null: back to
 * "not stated" ("-" or JSON null); [] : declared none ("nessuno" or an empty JSON list).
 * Never allergen-free by omission (M7 plan §3.1.6).
 */
function parseAllergens(value: unknown): Allergen[] | null | undefined | "invalid" {
  if (!Array.isArray(value) && isClear(value)) return null;
  if (isBlank(value) && !Array.isArray(value)) return undefined;
  const list = Array.isArray(value)
    ? value.map(String)
    : String(value)
        .split(ALLERGEN_SEPARATOR)
        .map((item) => item.trim())
        .filter(Boolean);
  if (!Array.isArray(value) && list.length === 1 && list[0]!.toLowerCase() === NONE_WORD) return [];
  const valid = list.every((item) => (ALLERGENS as readonly string[]).includes(item));
  return valid ? ([...new Set(list)].sort() as Allergen[]) : "invalid";
}

function mapIngredients(records: RawRecord[], errors: RowErrors): IngredientImportRow[] {
  const seen = new Set<string>();
  const rows: IngredientImportRow[] = [];
  for (const { line, values } of records) {
    const before = errors.list.length;
    const name = requiredText(values.nome);
    if (!name) errors.add(line, "nome", "required");
    else if (name.length > MAX_NAME_LENGTH.ingredient) errors.add(line, "nome", "too_long");

    const unit = text(values.unita_base)?.toLowerCase();
    if (!unit || !(BASE_UNITS as readonly string[]).includes(unit)) {
      errors.add(line, "unita_base", "invalid_unit");
    }
    const category = optionalText(values.categoria);
    if (category && category.length > MAX_CATEGORY_LENGTH)
      errors.add(line, "categoria", "too_long");
    const isStock = parseBoolean(values.a_magazzino);
    if (isStock === "invalid") errors.add(line, "a_magazzino", "invalid_boolean");
    const allergens = parseAllergens(values.allergeni);
    if (allergens === "invalid") errors.add(line, "allergeni", "invalid_allergen");
    const shelfLife = wholeNumber(values.giorni_conservazione, 1, 3650);
    if (shelfLife === "invalid") errors.add(line, "giorni_conservazione", "invalid_number");

    const key = name?.toLowerCase().replace(/\s+/g, " ");
    if (key) {
      if (seen.has(key)) errors.add(line, "nome", "duplicate_in_file");
      seen.add(key);
    }
    if (
      errors.list.length === before &&
      name &&
      isStock !== "invalid" &&
      allergens !== "invalid" &&
      shelfLife !== "invalid"
    ) {
      rows.push(
        withoutBlanks({
          row: line,
          name,
          base_unit: unit as BaseUnit,
          category,
          is_stock: isStock,
          allergens,
          default_shelf_life_days: shelfLife,
        }),
      );
    }
  }
  return rows;
}

export function supplierRowsFromCsv(csv: string): Mapped<SupplierImportRow> {
  const errors = new RowErrors();
  const rows = mapSuppliers(readCsv(csv, SUPPLIER_FIELDS, errors), errors);
  return { rows, errors: errors.list };
}

export function ingredientRowsFromCsv(csv: string): Mapped<IngredientImportRow> {
  const errors = new RowErrors();
  const rows = mapIngredients(readCsv(csv, INGREDIENT_FIELDS, errors), errors);
  return { rows, errors: errors.list };
}

export const importBody = z.discriminatedUnion("format", [
  z.strictObject({ format: z.literal("csv"), csv: z.string().max(MAX_IMPORT_CHARS) }),
  z.strictObject({
    format: z.literal("json"),
    rows: z.array(z.record(z.string(), z.unknown())).max(MAX_IMPORT_ROWS),
  }),
]);
export type ImportBody = z.infer<typeof importBody>;

type Kind = "suppliers" | "ingredients";

const KINDS = {
  suppliers: { fields: SUPPLIER_FIELDS, map: mapSuppliers, rpc: "import_suppliers" },
  ingredients: { fields: INGREDIENT_FIELDS, map: mapIngredients, rpc: "import_ingredients" },
} as const;

/** Validates every row, then imports all of them in one database transaction, or none. */
export async function importMasterData(
  supabase: SupabaseClient,
  kind: Kind,
  body: ImportBody,
): Promise<ImportCounts> {
  const { fields, map, rpc } = KINDS[kind];
  const errors = new RowErrors();
  const records =
    body.format === "csv" ? readCsv(body.csv, fields, errors) : readJson(body.rows, fields, errors);
  if (records.length > MAX_IMPORT_ROWS) {
    throw new ApiError(400, "invalid_request", `Al massimo ${MAX_IMPORT_ROWS} righe per file.`);
  }
  const rows = map(records, errors);
  if (errors.list.length > 0) {
    throw new ApiError(422, "import_invalid", "Il file contiene righe non valide.", errors.list);
  }
  const { data, error } = await supabase.rpc(rpc, { rows });
  if (error) throw mapDbError(error);
  // Logs and errors carry counts only, never row contents (personal data of sole traders).
  return data as ImportCounts;
}
