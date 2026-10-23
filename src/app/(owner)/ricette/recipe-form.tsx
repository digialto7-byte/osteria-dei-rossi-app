"use client";

import type { FormEvent, ReactNode } from "react";
import { Button, ErrorAlert, Field, Select, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  addLine,
  fieldsFor,
  removeLine,
  targetTypesFor,
  type LineForm,
  type RecipeFormState,
} from "@/lib/recipes/recipe-form";
import { typeLabel } from "@/lib/recipes/recipe-view";
import { OUTPUT_UNITS, RECIPE_TYPES, RECIPE_UNITS, type RecipeType } from "@/server/recipes/types";

export interface IngredientOption {
  id: string;
  name: string;
}
export interface RecipeOption {
  key: string;
  name: string;
  type: RecipeType;
}

interface RecipeFormProps {
  type: RecipeType;
  state: RecipeFormState;
  onChange: (state: RecipeFormState) => void;
  ingredients: IngredientOption[];
  recipes: RecipeOption[];
  /** The recipe being edited: it cannot be one of its own lines. */
  selfKey?: string;
  /** Owner and admin only; the chef's form has no price fields at all. */
  canEditPrice: boolean;
  /** Field problems by field name ("lines.0.qty"), from the form or from the API. */
  errors: Record<string, string>;
  summary: string | null;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  /** A new recipe chooses its type; a new version keeps the type of the recipe. */
  typePicker?: { value: RecipeType; onChange: (type: RecipeType) => void };
  /** Offered when the API said someone else saved a newer version. */
  onReload?: () => void;
}

const decimal = { inputMode: "decimal" as const, autoComplete: "off" };
const FIELD_LABEL = {
  outputQty: "recipes.form.outputQty",
  portionsPerBatch: "recipes.form.portionsPerBatch",
  shelfLifeHours: "recipes.form.shelfLifeHours",
  prepTimeMin: "recipes.form.prepTimeMin",
  minPortions: "recipes.form.minPortions",
  targetPortions: "recipes.form.targetPortions",
  salePrice: "recipes.form.salePrice",
  targetGpPct: "recipes.form.targetGpPct",
} as const;

function FieldError({ text }: { text: string | undefined }) {
  if (!text) return null;
  return <span className="text-sm leading-snug font-bold text-danger">{text}</span>;
}

/**
 * The form behind "Nuova ricetta" and "Nuova versione". It holds text and shows the problems it is
 * given; the page converts it to the API body and the server decides what is valid. Lines are
 * bordered rows, not cards. The chef's form has no price fields.
 */
export function RecipeForm(props: RecipeFormProps) {
  const { type, state, onChange, errors, canEditPrice } = props;
  const set = (patch: Partial<RecipeFormState>) => onChange({ ...state, ...patch });
  const setLine = (index: number, patch: Partial<LineForm>) =>
    set({ lines: state.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) });
  const shown = fieldsFor(type).filter(
    (field) => canEditPrice || (field !== "salePrice" && field !== "targetGpPct"),
  );
  const allowed = targetTypesFor(type);
  const chosenRecipes = props.recipes.filter(
    (recipe) => allowed.includes(recipe.type as "sub" | "batch") && recipe.key !== props.selfKey,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    props.onSubmit();
  }

  function pickTarget(index: number, target: string) {
    const recipe = chosenRecipes.find((r) => `r:${r.key}` === target);
    // A batch is used in portions; the server enforces it, this saves a tap.
    setLine(index, { target, ...(recipe?.type === "batch" ? { unit: "porz" } : {}) });
  }

  const input = (field: keyof typeof FIELD_LABEL): ReactNode => (
    <Field key={field} label={t(FIELD_LABEL[field])}>
      <TextInput
        {...decimal}
        value={state[field]}
        onChange={(e) => set({ [field]: e.target.value })}
        aria-invalid={errors[field] ? true : undefined}
      />
      <FieldError text={errors[field]} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorAlert message={props.summary} />
      {props.typePicker && (
        <Field label={t("recipes.form.type")}>
          <Select
            value={props.typePicker.value}
            onChange={(e) => props.typePicker!.onChange(e.target.value as RecipeType)}
          >
            {RECIPE_TYPES.map((value) => (
              <option key={value} value={value}>
                {typeLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("recipes.form.name")}>
        <TextInput
          value={state.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={120}
          aria-invalid={errors.name ? true : undefined}
        />
        <FieldError text={errors.name} />
      </Field>
      {shown.map((field) =>
        field === "outputUnit" ? (
          <Field key={field} label={t("recipes.form.outputUnit")}>
            <Select value={state.outputUnit} onChange={(e) => set({ outputUnit: e.target.value })}>
              {OUTPUT_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {t(`unit.${unit}`)}
                </option>
              ))}
            </Select>
            <FieldError text={errors.outputUnit} />
          </Field>
        ) : (
          input(field)
        ),
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-bold">{t("recipes.form.linesTitle")}</legend>
        <FieldError text={errors.lines} />
        {state.lines.map((line, index) => (
          <div
            key={index}
            role="group"
            aria-label={t("recipes.form.line", { n: index + 1 })}
            className="flex flex-col gap-3 rounded-lg border border-rule p-3"
          >
            <Field label={t("recipes.form.lineTarget")}>
              <Select
                value={line.target}
                onChange={(e) => pickTarget(index, e.target.value)}
                aria-invalid={errors[`lines.${index}.target`] ? true : undefined}
              >
                <option value="">{t("recipes.form.chooseTarget")}</option>
                <optgroup label={t("recipes.form.groupIngredients")}>
                  {props.ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={`i:${ingredient.id}`}>
                      {ingredient.name}
                    </option>
                  ))}
                </optgroup>
                {chosenRecipes.length > 0 && (
                  <optgroup label={t("recipes.form.groupRecipes")}>
                    {chosenRecipes.map((recipe) => (
                      <option key={recipe.key} value={`r:${recipe.key}`}>
                        {recipe.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
              <FieldError
                text={
                  errors[`lines.${index}.target`] ??
                  errors[`lines.${index}.ingredientId`] ??
                  errors[`lines.${index}.recipeKey`] ??
                  errors[`lines.${index}`]
                }
              />
            </Field>
            <Field label={t("recipes.form.lineQty")}>
              <TextInput
                {...decimal}
                value={line.qty}
                onChange={(e) => setLine(index, { qty: e.target.value })}
                aria-invalid={errors[`lines.${index}.qty`] ? true : undefined}
              />
              <FieldError text={errors[`lines.${index}.qty`]} />
            </Field>
            <Field label={t("recipes.form.lineUnit")}>
              <Select value={line.unit} onChange={(e) => setLine(index, { unit: e.target.value })}>
                {RECIPE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`unit.${unit}`)}
                  </option>
                ))}
              </Select>
              <FieldError text={errors[`lines.${index}.unit`]} />
            </Field>
            <Field label={t("recipes.form.lineYield")} hint={t("recipes.form.yieldHint")}>
              <TextInput
                {...decimal}
                value={line.yieldFactor}
                placeholder="1"
                onChange={(e) => setLine(index, { yieldFactor: e.target.value })}
                aria-invalid={errors[`lines.${index}.yieldFactor`] ? true : undefined}
              />
              <FieldError text={errors[`lines.${index}.yieldFactor`]} />
            </Field>
            {state.lines.length > 1 && (
              <div>
                <Button variant="quiet" onClick={() => onChange(removeLine(state, index))}>
                  {t("recipes.form.removeLine", { n: index + 1 })}
                </Button>
              </div>
            )}
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={() => onChange(addLine(state))}>
            {t("recipes.form.addLine")}
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={props.busy}>
          {props.submitLabel}
        </Button>
        <Button variant="quiet" onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        {props.onReload && (
          <Button variant="secondary" onClick={props.onReload}>
            {t("recipes.form.reload")}
          </Button>
        )}
      </div>
    </form>
  );
}
