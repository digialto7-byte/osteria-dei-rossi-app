import { ApiError, type ErrorDetail } from "@/lib/api/errors";
import { CsvError, parseCsvRecords } from "@/lib/csv/parse";
import { MAX_IMPORT_ROWS } from "@/server/master/import";
import {
  OUTPUT_UNITS,
  RECIPE_TYPES,
  RECIPE_UNITS,
  type OutputUnit,
  type RecipeImportRow,
  type RecipeTemplate,
  type RecipeType,
  type RecipeUnit,
  type TemplateLine,
} from "./types";

// The recipe template (M7 plan §3.6). CSV: one row per recipe line, ";" or ",", Italian headers.
// JSON: the same shape as the export. Both become RecipeImportRow[] with the file line of each recipe;
// errors carry the line, the field and a code, never the contents of a cell.

export interface MappedRecipes {
  rows: RecipeImportRow[];
  errors: ErrorDetail[];
}

const MAX_REPORTED_ERRORS = 50;
const HEADER_LINE = 1;
// The clear mark of the M1 template: on a price it removes the stored price.
const CLEAR_MARK = "-";
const FORMULA_START = /^[=+@]/;
const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(?:[.,]\d+)?$/;

const COLUMNS = [
  "ricetta",
  "tipo",
  "uscita_qty",
  "uscita_unita",
  "porzioni",
  "conservazione_ore",
  "preparazione_min",
  "porzioni_min",
  "porzioni_obiettivo",
  "prezzo_vendita",
  "gp_obiettivo",
  "ingrediente",
  "sottoricetta",
  "qty",
  "unita",
  "resa",
] as const;
type Column = (typeof COLUMNS)[number];

const TYPE_WORDS: Record<string, RecipeType> = {
  lotto: "batch",
  piatto: "plate",
  sottoricetta: "sub",
};

class Errors {
  readonly list: ErrorDetail[] = [];
  add(row: number, field: string, code: string) {
    if (this.list.length < MAX_REPORTED_ERRORS) this.list.push({ row, field, code });
  }
}

const normaliseName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

type Parsed<T> = T | undefined | "invalid";

function decimal(text: string): Parsed<number> {
  if (text === "") return undefined;
  return DECIMAL.test(text) ? Number(text.replace(",", ".")) : "invalid";
}

function whole(text: string): Parsed<number> {
  if (text === "") return undefined;
  return WHOLE.test(text) ? Number(text) : "invalid";
}

// Recipe-level columns: where each goes in the recipe, and how its text is read.
type RecipeLevel = Partial<Omit<RecipeTemplate, "name" | "lines">>;
interface LevelField {
  column: Column;
  key: keyof RecipeLevel;
  read(text: string): Parsed<number | string | null>;
  invalid: string;
}
const priceField = (text: string): Parsed<number | null> =>
  text === CLEAR_MARK ? null : decimal(text);
const unitField = (text: string): Parsed<OutputUnit> => {
  if (text === "") return undefined;
  const unit = text.toLowerCase();
  return (OUTPUT_UNITS as readonly string[]).includes(unit) ? (unit as OutputUnit) : "invalid";
};
const typeField = (text: string): Parsed<RecipeType> => {
  if (text === "") return undefined;
  return TYPE_WORDS[text.toLowerCase()] ?? "invalid";
};

const LEVEL_FIELDS: LevelField[] = [
  { column: "tipo", key: "type", read: typeField, invalid: "invalid_value" },
  { column: "uscita_qty", key: "outputQty", read: decimal, invalid: "invalid_number" },
  { column: "uscita_unita", key: "outputUnit", read: unitField, invalid: "invalid_unit" },
  { column: "porzioni", key: "portionsPerBatch", read: whole, invalid: "invalid_number" },
  { column: "conservazione_ore", key: "shelfLifeHours", read: whole, invalid: "invalid_number" },
  { column: "preparazione_min", key: "prepTimeMin", read: whole, invalid: "invalid_number" },
  { column: "porzioni_min", key: "minPortions", read: whole, invalid: "invalid_number" },
  { column: "porzioni_obiettivo", key: "targetPortions", read: whole, invalid: "invalid_number" },
  { column: "prezzo_vendita", key: "salePrice", read: priceField, invalid: "invalid_number" },
  { column: "gp_obiettivo", key: "targetGpPct", read: priceField, invalid: "invalid_number" },
];

interface Entry {
  row: number;
  name: string;
  level: RecipeLevel;
  lines: TemplateLine[];
  broken: boolean;
}

function readLine(
  cell: (column: Column) => string,
  bad: Set<Column>,
  line: number,
  errors: Errors,
) {
  const ingredient = cell("ingrediente");
  const recipe = cell("sottoricetta");
  const out: Partial<TemplateLine> = {};
  let ok = true;
  const fail = (field: string, code: string) => {
    errors.add(line, field, code);
    ok = false;
  };

  if (
    (ingredient === "") === (recipe === "") &&
    !bad.has("ingrediente") &&
    !bad.has("sottoricetta")
  ) {
    fail("ingrediente", "line_target_required");
  }
  if (ingredient !== "") out.ingredient = ingredient;
  if (recipe !== "") out.recipe = recipe;

  if (!bad.has("qty")) {
    const qty = decimal(cell("qty"));
    if (qty === undefined) fail("qty", "required");
    else if (qty === "invalid") fail("qty", "invalid_number");
    else out.qty = qty;
  }
  if (!bad.has("unita")) {
    const unit = cell("unita").toLowerCase();
    if (unit === "") fail("unita", "required");
    else if (!(RECIPE_UNITS as readonly string[]).includes(unit)) fail("unita", "invalid_unit");
    else out.unit = unit as RecipeUnit;
  }
  if (!bad.has("resa")) {
    const factor = decimal(cell("resa"));
    if (factor === "invalid") fail("resa", "invalid_number");
    else if (factor !== undefined) out.yieldFactor = factor;
  }
  return ok && bad.size === 0 ? (out as TemplateLine) : null;
}

/** Reads a recipe-level cell. On the first row it sets the value; on a later row it must agree. */
function readLevel(
  entry: Entry,
  cell: (column: Column) => string,
  bad: Set<Column>,
  line: number,
  first: boolean,
  errors: Errors,
) {
  for (const field of LEVEL_FIELDS) {
    if (bad.has(field.column)) continue;
    const value = field.read(cell(field.column));
    if (value === "invalid") {
      errors.add(line, field.column, field.invalid);
      entry.broken = true;
    } else if (first) {
      if (value === undefined && field.key === "type") {
        errors.add(line, field.column, "required");
        entry.broken = true;
      }
      if (value !== undefined) (entry.level as Record<string, unknown>)[field.key] = value;
    } else if (
      value !== undefined &&
      value !== (entry.level as Record<string, unknown>)[field.key]
    ) {
      errors.add(line, field.column, "recipe_fields_disagree");
      entry.broken = true;
    }
  }
}

function recipeFromEntry(entry: Entry): RecipeImportRow | null {
  const { type, ...rest } = entry.level;
  if (type === undefined || entry.broken) return null;
  return { row: entry.row, name: entry.name, type, ...rest, lines: entry.lines };
}

function readCsvHeader(header: string[], line: number, errors: Errors): string[] {
  const columns = header.map((name) => name.trim().toLowerCase());
  for (const column of columns) {
    if (!(COLUMNS as readonly string[]).includes(column))
      errors.add(line, column, "unknown_column");
  }
  if (!columns.includes("ricetta")) errors.add(line, "ricetta", "missing_column");
  return columns;
}

/** Maps the flat CSV template to recipes, grouping the rows of a recipe by its normalised name. */
export function recipeRowsFromCsv(csv: string): MappedRecipes {
  const errors = new Errors();
  let table;
  try {
    table = parseCsvRecords(csv);
  } catch (error) {
    if (error instanceof CsvError) {
      errors.add(error.line, "(file)", "unterminated_quote");
      return { rows: [], errors: errors.list };
    }
    throw error;
  }
  const [header, ...data] = table;
  const columns = readCsvHeader(header?.cells ?? [], header?.line ?? HEADER_LINE, errors);
  if (errors.list.length > 0) return { rows: [], errors: errors.list };
  if (data.length > MAX_IMPORT_ROWS) {
    throw new ApiError(400, "invalid_request", `Al massimo ${MAX_IMPORT_ROWS} righe per file.`);
  }

  const entries = new Map<string, Entry>();
  let current: Entry | null = null;
  for (const { line, cells } of data) {
    const bad = new Set<Column>();
    const values = new Map<string, string>();
    columns.forEach((column, i) => {
      const text = (cells[i] ?? "").trim();
      values.set(column, text);
      // A spreadsheet would run this cell as a formula when the file is opened again.
      if (FORMULA_START.test(text)) {
        errors.add(line, column, "invalid_value");
        bad.add(column as Column);
      }
    });
    const cell = (column: Column) => (bad.has(column) ? "" : (values.get(column) ?? ""));

    const name = cell("ricetta");
    let entry: Entry | null = null;
    let first = false;
    if (bad.has("ricetta")) {
      continue;
    } else if (name === "") {
      entry = current;
      if (!entry) {
        errors.add(line, "ricetta", "required");
        continue;
      }
    } else {
      entry = entries.get(normaliseName(name)) ?? null;
      if (!entry) {
        entry = { row: line, name, level: {}, lines: [], broken: false };
        entries.set(normaliseName(name), entry);
        first = true;
      }
    }
    current = entry;
    readLevel(entry, cell, bad, line, first, errors);
    const parsed = readLine(cell, bad, line, errors);
    if (parsed) entry.lines.push(parsed);
    else entry.broken = true;
  }

  const rows = [...entries.values()].flatMap((entry) => {
    const row = recipeFromEntry(entry);
    return row ? [row] : [];
  });
  return { rows, errors: errors.list };
}

// JSON ---------------------------------------------------------------------------------------------

const RECIPE_KEYS = [
  "name",
  "type",
  "outputQty",
  "outputUnit",
  "portionsPerBatch",
  "shelfLifeHours",
  "prepTimeMin",
  "minPortions",
  "targetPortions",
  "salePrice",
  "targetGpPct",
  "lines",
] as const;
const NUMBER_KEYS = [
  "outputQty",
  "portionsPerBatch",
  "shelfLifeHours",
  "prepTimeMin",
  "minPortions",
  "targetPortions",
] as const;
const PRICE_KEYS = ["salePrice", "targetGpPct"] as const;
const LINE_KEYS = ["ingredient", "recipe", "qty", "unit", "yieldFactor"] as const;

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function readJsonLines(raw: unknown, row: number, errors: Errors): TemplateLine[] | null {
  if (raw === undefined) {
    errors.add(row, "lines", "required");
    return null;
  }
  if (!Array.isArray(raw)) {
    errors.add(row, "lines", "invalid_value");
    return null;
  }
  const lines: TemplateLine[] = [];
  let ok = true;
  raw.forEach((item: unknown, index) => {
    const at = `lines.${index}`;
    const fail = (field: string, code: string) => {
      errors.add(row, field, code);
      ok = false;
    };
    if (!isObject(item)) return fail(at, "invalid_value");
    for (const key of Object.keys(item)) {
      if (!(LINE_KEYS as readonly string[]).includes(key)) fail(`${at}.${key}`, "unknown_column");
    }
    const names = (["ingredient", "recipe"] as const).filter((key) => item[key] !== undefined);
    if (names.length !== 1) fail(at, "line_target_required");
    const line: Partial<TemplateLine> = {};
    for (const key of names) {
      const value = item[key];
      if (typeof value !== "string" || value.trim() === "") fail(`${at}.${key}`, "required");
      else if (FORMULA_START.test(value.trim())) fail(`${at}.${key}`, "invalid_value");
      else line[key] = value;
    }
    if (item.qty === undefined) fail(`${at}.qty`, "required");
    else if (!isNumber(item.qty)) fail(`${at}.qty`, "invalid_number");
    else line.qty = item.qty;
    if (item.unit === undefined) fail(`${at}.unit`, "required");
    else if (!(RECIPE_UNITS as readonly unknown[]).includes(item.unit))
      fail(`${at}.unit`, "invalid_unit");
    else line.unit = item.unit as RecipeUnit;
    if (item.yieldFactor !== undefined) {
      if (!isNumber(item.yieldFactor)) fail(`${at}.yieldFactor`, "invalid_number");
      else line.yieldFactor = item.yieldFactor;
    }
    lines.push(line as TemplateLine);
  });
  return ok ? lines : null;
}

function readJsonRecipe(item: unknown, row: number, errors: Errors): RecipeImportRow | null {
  if (!isObject(item)) {
    errors.add(row, "(row)", "invalid_value");
    return null;
  }
  const before = errors.list.length;
  for (const key of Object.keys(item)) {
    if (!(RECIPE_KEYS as readonly string[]).includes(key)) errors.add(row, key, "unknown_column");
  }
  const out: Partial<RecipeImportRow> & Loose = { row };

  const name = item.name;
  if (typeof name !== "string" || name.trim() === "") errors.add(row, "name", "required");
  else if (FORMULA_START.test(name.trim())) errors.add(row, "name", "invalid_value");
  else out.name = name.trim();

  if (!(RECIPE_TYPES as readonly unknown[]).includes(item.type))
    errors.add(row, "type", "invalid_value");
  else out.type = item.type as RecipeType;

  for (const key of NUMBER_KEYS) {
    const value = item[key];
    if (value === undefined || value === null) continue;
    if (!isNumber(value)) errors.add(row, key, "invalid_number");
    else out[key] = value;
  }
  for (const key of PRICE_KEYS) {
    const value = item[key];
    if (value === undefined) continue;
    if (value !== null && !isNumber(value)) errors.add(row, key, "invalid_number");
    else out[key] = value;
  }
  const unit = item.outputUnit;
  if (unit !== undefined && unit !== null) {
    if (!(OUTPUT_UNITS as readonly unknown[]).includes(unit))
      errors.add(row, "outputUnit", "invalid_unit");
    else out.outputUnit = unit as OutputUnit;
  }

  const lines = readJsonLines(item.lines, row, errors);
  if (lines) out.lines = lines;
  return errors.list.length === before ? (out as RecipeImportRow) : null;
}

/** Maps the JSON template (the export's shape) to recipes; a recipe's row is its position (1-based). */
export function recipeRowsFromJson(recipes: unknown[]): MappedRecipes {
  const errors = new Errors();
  const seen = new Set<string>();
  const rows: RecipeImportRow[] = [];
  recipes.forEach((item, index) => {
    const row = readJsonRecipe(item, index + 1, errors);
    if (!row) return;
    const key = normaliseName(row.name);
    if (seen.has(key)) errors.add(row.row, "name", "duplicate_in_file");
    seen.add(key);
    rows.push(row);
  });
  return { rows, errors: errors.list };
}
