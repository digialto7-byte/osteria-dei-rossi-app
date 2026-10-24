import { t } from "@/lib/i18n";
import { parseDecimal, toField } from "@/lib/numbers/parse-decimal";
import { detailList, type ApiErrorBody } from "@/lib/api/client";
import type { RecipeDetail } from "@/server/recipes/detail";
import type { RecipeContent } from "@/server/recipes/schemas";
import { RECIPE_UNITS, type RecipeType } from "@/server/recipes/types";
import { fieldErrorText, recipeErrorText } from "./recipe-view";

// The recipe form's state is text (what the inputs hold). These helpers turn it into the API body
// and back, and word the errors by field. The server decides what is valid; this only reads numbers
// typed with a decimal comma and leaves out the fields a type does not use.

export interface LineForm {
  /** "i:<ingredient id>" or "r:<recipe key>", empty until chosen. */
  target: string;
  qty: string;
  unit: string;
  yieldFactor: string;
}

export interface RecipeFormState {
  name: string;
  outputQty: string;
  outputUnit: string;
  portionsPerBatch: string;
  shelfLifeHours: string;
  prepTimeMin: string;
  minPortions: string;
  targetPortions: string;
  salePrice: string;
  targetGpPct: string;
  lines: LineForm[];
}

type FieldKey = Exclude<keyof RecipeFormState, "name" | "lines">;

// Which fields a type shows (the server's type rules decide what is accepted).
const FIELDS: Record<RecipeType, readonly FieldKey[]> = {
  batch: [
    "outputQty",
    "outputUnit",
    "portionsPerBatch",
    "shelfLifeHours",
    "prepTimeMin",
    "minPortions",
    "targetPortions",
  ],
  sub: ["outputQty", "outputUnit", "prepTimeMin"],
  plate: ["salePrice", "targetGpPct"],
};
export const fieldsFor = (type: RecipeType): readonly FieldKey[] => FIELDS[type];

const WHOLE_FIELDS: readonly FieldKey[] = [
  "portionsPerBatch",
  "shelfLifeHours",
  "prepTimeMin",
  "minPortions",
  "targetPortions",
];
const DECIMAL_FIELDS: readonly FieldKey[] = ["outputQty", "salePrice", "targetGpPct"];
const PRICE_FIELDS: readonly FieldKey[] = ["salePrice", "targetGpPct"];

/** The recipe types a line of this type of recipe may point at (a batch only inside a plate). */
export const targetTypesFor = (type: RecipeType): readonly ("sub" | "batch")[] =>
  type === "plate" ? ["sub", "batch"] : ["sub"];

const blankLine = (): LineForm => ({ target: "", qty: "", unit: "kg", yieldFactor: "" });

export function emptyForm(_type: RecipeType): RecipeFormState {
  return {
    name: "",
    outputQty: "",
    outputUnit: "kg",
    portionsPerBatch: "",
    shelfLifeHours: "",
    prepTimeMin: "",
    minPortions: "",
    targetPortions: "",
    salePrice: "",
    targetGpPct: "",
    lines: [blankLine()],
  };
}

export const addLine = (state: RecipeFormState): RecipeFormState => ({
  ...state,
  lines: [...state.lines, blankLine()],
});

/** Removes a line by position; the form always keeps at least one. */
export function removeLine(state: RecipeFormState, index: number): RecipeFormState {
  const lines = state.lines.filter((_, i) => i !== index);
  return { ...state, lines: lines.length > 0 ? lines : [blankLine()] };
}

const text = (value: number | null | undefined) => (value == null ? "" : toField(value));

/** Prefills a new version from a version of the recipe. */
export function formFromDetail(detail: RecipeDetail): RecipeFormState {
  return {
    name: detail.name,
    outputQty: text(detail.outputQty),
    outputUnit: detail.outputUnit ?? "kg",
    portionsPerBatch: text(detail.portionsPerBatch),
    shelfLifeHours: text(detail.shelfLifeHours),
    prepTimeMin: text(detail.prepTimeMin),
    minPortions: text(detail.minPortions),
    targetPortions: text(detail.targetPortions),
    salePrice: text(detail.pricing?.salePrice),
    targetGpPct: text(detail.pricing?.targetGpPct),
    lines: detail.lines.map((line) => ({
      target: `${line.target.kind === "ingredient" ? "i" : "r"}:${line.target.id}`,
      qty: toField(line.qty),
      unit: line.unit,
      yieldFactor: toField(line.yieldFactor),
    })),
  };
}

export type FormResult =
  { ok: true; body: RecipeContent } | { ok: false; errors: Record<string, string> };

/**
 * The API body from the form. Fields the type does not use are left out, a blank optional field is
 * left out, except a blank price which is sent as null (it clears the stored price), and the price
 * is sent only when the caller may edit it (the chef never sends it).
 */
export function formToBody(
  state: RecipeFormState,
  type: RecipeType,
  options: { canEditPrice: boolean },
): FormResult {
  const errors: Record<string, string> = {};
  const invalid = t("recipes.form.invalidNumber");
  const body: Record<string, unknown> = { name: state.name.trim() };

  for (const field of fieldsFor(type)) {
    if (PRICE_FIELDS.includes(field) && !options.canEditPrice) continue;
    const raw = state[field];
    if (field === "outputUnit") {
      if (state.outputQty.trim() !== "" || type !== "plate") body.outputUnit = raw;
      continue;
    }
    const parsed = parseDecimal(raw);
    if (
      !parsed.ok ||
      (WHOLE_FIELDS.includes(field) && parsed.value !== null && !Number.isInteger(parsed.value))
    ) {
      errors[field] = invalid;
    } else if (
      parsed.value !== null &&
      (DECIMAL_FIELDS.includes(field) || WHOLE_FIELDS.includes(field))
    ) {
      body[field] = parsed.value;
    } else if (parsed.ok && parsed.value === null && PRICE_FIELDS.includes(field)) {
      // Blank on a screen that may edit prices means "no price": null clears it (absent would keep it).
      body[field] = null;
    }
  }

  const lines: RecipeContent["lines"] = [];
  state.lines.forEach((line, index) => {
    const at = `lines.${index}`;
    const qty = parseDecimal(line.qty);
    const factor = parseDecimal(line.yieldFactor);
    if (!qty.ok || qty.value === null) errors[`${at}.qty`] = invalid;
    if (!factor.ok) errors[`${at}.yieldFactor`] = invalid;
    const [kind, id] = line.target.split(":");
    if (!id || (kind !== "i" && kind !== "r")) {
      errors[`${at}.target`] = t("recipes.form.chooseTargetError");
      return;
    }
    if (!RECIPE_UNITS.includes(line.unit as (typeof RECIPE_UNITS)[number])) return;
    lines.push({
      ...(kind === "i" ? { ingredientId: id } : { recipeKey: id }),
      qty: qty.ok && qty.value !== null ? qty.value : 0,
      unit: line.unit as (typeof RECIPE_UNITS)[number],
      ...(factor.ok && factor.value !== null ? { yieldFactor: factor.value } : {}),
    });
  });
  body.lines = lines;

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, body: body as RecipeContent };
}

export interface FormErrors {
  summary: string;
  fields: Record<string, string>;
}

/** Words an API error for the form: a summary, and a text per field for `recipe_invalid`. */
export function formErrorsFromApi(error: ApiErrorBody): FormErrors {
  const fields: Record<string, string> = {};
  const details = detailList(error.details);
  if (error.code === "recipe_invalid") {
    for (const detail of details ?? []) {
      const field = String(detail.field ?? "");
      if (field) fields[field] = fieldErrorText(detail);
    }
  }
  return { summary: recipeErrorText(error.code, details) ?? error.message, fields };
}
