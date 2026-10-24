"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, Select, TextInput } from "@/components/ui";
import { parseUsedQty } from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { RuleField } from "@/lib/staff-meals/staff-meal-view";
import { STOCK_INPUT_UNITS, UNITS_FOR_BASE, type StockInputUnit } from "@/server/stock/constants";
import type { BaseUnit } from "@/server/stock/types";

export type RuleValues =
  | { kind: "recipe"; recipeKey: string; defaultCount: number }
  | {
      kind: "ingredient";
      ingredientId: string;
      defaultCount: number;
      unit: StockInputUnit;
      locationId?: string;
    };

/**
 * "Nuova regola": the type (a preparation or an ingredient), the target from the lists it was given, the quantity
 * (and, for an ingredient, the unit and the location). One submit button, styled secondary: the staff-meal screen's
 * primary actions are the confirm buttons. It only reads what was typed; the target's type, the unit and the limits
 * are the database's, and the field a refusal concerns comes back as `invalidField`.
 */
export function RuleForm({
  recipes,
  ingredients,
  locations,
  busy,
  error,
  invalidField,
  onSubmit,
  initialKind = "recipe",
  initialTarget = "",
  locale = DEFAULT_LOCALE,
}: {
  recipes: readonly { key: string; name: string }[];
  ingredients: readonly { id: string; name: string; baseUnit: BaseUnit }[];
  locations: readonly { id: string; name: string }[];
  busy: boolean;
  error: string | null;
  invalidField: RuleField | null;
  onSubmit: (values: RuleValues) => Promise<boolean>;
  initialKind?: "recipe" | "ingredient";
  initialTarget?: string;
  locale?: Locale;
}) {
  const [kind, setKind] = useState<"recipe" | "ingredient">(initialKind);
  const [target, setTarget] = useState(initialTarget);
  const [count, setCount] = useState("");
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState("");
  const [problem, setProblem] = useState<{ field: RuleField; message: string } | null>(null);

  const picked = ingredients.find((ingredient) => ingredient.id === target);
  const units: readonly StockInputUnit[] =
    kind === "ingredient" && picked ? UNITS_FOR_BASE[picked.baseUnit] : STOCK_INPUT_UNITS;
  const unitValue = (units as readonly string[]).includes(unit) ? unit : units[0]!;
  const refused = problem?.field ?? invalidField;
  const invalid = (field: RuleField) => (refused === field ? { "aria-invalid": true } : {});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target) {
      return setProblem({
        field: "target",
        message: t("staffMeal.form.targetRequired", {}, locale),
      });
    }
    const value = parseUsedQty(count);
    if (value === null || value === 0) {
      return setProblem({ field: "count", message: t("staffMealError.count_invalid", {}, locale) });
    }
    setProblem(null);
    const saved = await onSubmit(
      kind === "recipe"
        ? { kind, recipeKey: target, defaultCount: value }
        : {
            kind,
            ingredientId: target,
            defaultCount: value,
            unit: unitValue as StockInputUnit,
            ...(location ? { locationId: location } : {}),
          },
    );
    if (saved) {
      setTarget("");
      setCount("");
    }
  };

  const targets =
    kind === "recipe"
      ? recipes.map((recipe) => ({ value: recipe.key, label: recipe.name }))
      : ingredients.map((ingredient) => ({ value: ingredient.id, label: ingredient.name }));
  return (
    <form
      onSubmit={submit}
      aria-label={t("staffMeal.form.title", {}, locale)}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
    >
      <Field label={t("staffMeal.form.kind", {}, locale)}>
        <Select
          name="kind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as "recipe" | "ingredient");
            setTarget("");
            setProblem(null);
          }}
        >
          {(["recipe", "ingredient"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`staffMeal.form.kind.${value}`, {}, locale)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t(`staffMeal.form.target.${kind}`, {}, locale)}>
        <Select
          name="target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          {...invalid("target")}
        >
          <option value="">{t("staffMeal.form.targetPlaceholder", {}, locale)}</option>
          {targets.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("staffMeal.form.count", {}, locale)}>
        <TextInput
          name="count"
          inputMode="decimal"
          autoComplete="off"
          value={count}
          onChange={(event) => setCount(event.target.value)}
          {...invalid("count")}
        />
      </Field>
      {kind === "ingredient" && (
        <Field label={t("staffMeal.form.unit", {}, locale)}>
          <Select
            name="unit"
            value={unitValue}
            onChange={(event) => setUnit(event.target.value)}
            {...invalid("unit")}
          >
            {units.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {kind === "ingredient" && locations.length >= 2 && (
        <Field label={t("staffMeal.form.location", {}, locale)}>
          <Select
            name="location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            {...invalid("location")}
          >
            <option value="">{t("staffMeal.form.locationAuto", {}, locale)}</option>
            {locations.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <ErrorAlert message={problem?.message ?? error} />
      <div>
        <Button type="submit" variant="secondary" disabled={busy}>
          {t("staffMeal.form.submit", {}, locale)}
        </Button>
      </div>
    </form>
  );
}
