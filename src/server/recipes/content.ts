import type { RecipeContent } from "./schemas";
import type { RecipeImportRow, RecipeTemplate, RecipeType, TemplateLine } from "./types";

/** The content part of a create or new-version body: what the database procedures take. */
export function contentOf(
  body: RecipeContent & { type?: RecipeType; baseVersion?: number },
): RecipeContent {
  const { type: _type, baseVersion: _baseVersion, ...content } = body;
  return content;
}

const withoutUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/**
 * One fixed form of a template recipe: no undefined keys, keys in a fixed order, lines in file order.
 * A null price stays (it is the clear mark). The export has the same shape, so a file and its export
 * compare equal.
 */
export function canonicalTemplate(recipe: RecipeTemplate): RecipeTemplate {
  const { name, type, lines, ...rest } = recipe;
  const optional = withoutUndefined(rest);
  const ordered = Object.fromEntries(Object.entries(optional).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    name,
    type,
    ...ordered,
    lines: lines.map((line): TemplateLine => {
      const { ingredient, recipe: sub, qty, unit, yieldFactor } = line;
      return withoutUndefined({ ingredient, recipe: sub, qty, unit, yieldFactor }) as TemplateLine;
    }),
  };
}

/** A row of `import_recipes(p_rows)`: the canonical recipe and the file row it came from. */
export function toRpcRow(row: RecipeImportRow): RecipeImportRow {
  const { row: number, ...recipe } = row;
  return { row: number, ...canonicalTemplate(recipe) };
}
