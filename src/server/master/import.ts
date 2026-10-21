import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError, type ErrorDetail } from "@/lib/api/errors";
import { CsvError, parseCsvRecords, type CsvRecord } from "@/lib/csv/parse";
import { BASE_UNITS, type BaseUnit } from "@/lib/units";
import { isValidItVat, normaliseItVat } from "@/lib/vat/it-vat";
import { mapDbError } from "./db-errors";
import { ALLERGENS, type Allergen } from "./ingredients";

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_CHARS = 512_000;
// UTF-8 needs at most 4 bytes per character, plus JSON escaping overhead.
export const MAX_IMPORT_BODY_BYTES = MAX_IMPORT_CHARS * 4 + 16_384;
const MAX_REPORTED_ERRORS = 50;
const HEADER_LINE = 1;
const MAX_NAME_LENGTH = { supplier: 200, ingredient: 120 } as const;
const MAX_CATEGORY_LENGTH = 60;
const ALLERGEN_SEPARATOR = "|";
const TRUE_WORDS = new Set(["si", "sì", "s", "yes", "true", "1"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0"]);

export interface ImportCounts {
  created: number;
  updated: number;
  unchanged: number;
}

export interface SupplierImportRow {
  row: number;
  name: string;
  vat_number: string | null;
  payment_terms_days: number | null;
}

export interface IngredientImportRow {
  row: number;
  name: string;
  base_unit: BaseUnit;
  category: string | null;
  is_stock: boolean;
  allergens: Allergen[];
  default_shelf_life_days: number | null;
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
  add(row: number, field: string, code: string) {
    if (this.list.length < MAX_REPORTED_ERRORS) this.list.push({ row, field, code });
  }
}

const isBlank = (value: unknown) =>
  value === undefined || value === null || String(value).trim() === "";
const text = (value: unknown) => (isBlank(value) ? null : String(value).trim());

function wholeNumber(value: unknown, min: number, max: number): number | null | "invalid" {
  if (isBlank(value)) return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(number) && number >= min && number <= max ? number : "invalid";
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
  const columns = (header?.cells ?? []).map((name) => name.trim().toLowerCase());
  for (const column of columns) {
    if (!(column in fields)) errors.add(HEADER_LINE, column, "unknown_column");
  }
  if (!columns.includes("nome")) errors.add(HEADER_LINE, "nome", "missing_column");
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
      if (column) values[column] = value;
      else errors.add(line, key, "unknown_column");
    }
    return { line, values };
  });
}

function mapSuppliers(records: RawRecord[], errors: RowErrors): SupplierImportRow[] {
  const seen = new Set<string>();
  const rows: SupplierImportRow[] = [];
  for (const { line, values } of records) {
    const before = errors.list.length;
    const name = text(values.nome);
    if (!name) errors.add(line, "nome", "required");
    else if (name.length > MAX_NAME_LENGTH.supplier) errors.add(line, "nome", "too_long");

    const rawVat = text(values.partita_iva);
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
      rows.push({ row: line, name, vat_number: vat, payment_terms_days: terms });
    }
  }
  return rows;
}

function parseBoolean(value: unknown): boolean | null | "invalid" {
  if (isBlank(value)) return null;
  if (typeof value === "boolean") return value;
  const word = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  return "invalid";
}

function parseAllergens(value: unknown): Allergen[] | "invalid" {
  if (isBlank(value)) return [];
  const list = Array.isArray(value)
    ? value.map(String)
    : String(value)
        .split(ALLERGEN_SEPARATOR)
        .map((item) => item.trim())
        .filter(Boolean);
  const valid = list.every((item) => (ALLERGENS as readonly string[]).includes(item));
  return valid ? ([...new Set(list)].sort() as Allergen[]) : "invalid";
}

function mapIngredients(records: RawRecord[], errors: RowErrors): IngredientImportRow[] {
  const seen = new Set<string>();
  const rows: IngredientImportRow[] = [];
  for (const { line, values } of records) {
    const before = errors.list.length;
    const name = text(values.nome);
    if (!name) errors.add(line, "nome", "required");
    else if (name.length > MAX_NAME_LENGTH.ingredient) errors.add(line, "nome", "too_long");

    const unit = text(values.unita_base)?.toLowerCase();
    if (!unit || !(BASE_UNITS as readonly string[]).includes(unit)) {
      errors.add(line, "unita_base", "invalid_unit");
    }
    const category = text(values.categoria);
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
      rows.push({
        row: line,
        name,
        base_unit: unit as BaseUnit,
        category,
        is_stock: isStock ?? true,
        allergens,
        default_shelf_life_days: shelfLife,
      });
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
