"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  ErrorAlert,
  Heading,
  LedgerList,
  Muted,
  SubHeading,
  SuccessNote,
  linkClass,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { ruleErrorField, type RuleField } from "@/lib/staff-meals/staff-meal-view";
import { formatCalendarDate } from "@/lib/time/format";
import type { BaseUnit } from "@/server/stock/types";
import type {
  StaffMealConfirmation,
  StaffMealRuleItem,
  StaffMealRuleResult,
  StaffMealRules,
} from "@/server/staff-meals/types";
import { RuleForm, type RuleValues } from "./rule-form";
import { RuleRow } from "./rule-row";

const FORBIDDEN = 403;

interface Place {
  id: string;
  name: string;
  isActive?: boolean;
}

/**
 * "Pasti del personale": the day (the server's business date), one row per rule with its one-tap confirmation, and
 * the rules section. Reads /api/staff-meals, /api/recipes?type=batch, /api/ingredients and /api/locations; confirms
 * through POST /api/staff-meals/:id/confirm and saves rules through POST /api/staff-meals. Whether a meal is already
 * confirmed, what is available and the business date are the API's.
 */
export default function StaffMealsPage() {
  const [data, setData] = useState<StaffMealRules | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formField, setFormField] = useState<RuleField | null>(null);
  const [recipes, setRecipes] = useState<{ key: string; name: string }[]>([]);
  const [ingredients, setIngredients] = useState<
    { id: string; name: string; baseUnit: BaseUnit }[]
  >([]);
  const [places, setPlaces] = useState<{ id: string; name: string }[]>([]);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(async () => {
    const isNewest = startRequest();
    const result = await apiJson<StaffMealRules>("/api/staff-meals");
    if (!isNewest()) return;
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setError(result.error.message);
      return;
    }
    setError(null);
    setData(result.data);
  }, [startRequest]);

  useEffect(() => {
    // Loading the rules when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** The lists the rule form picks from, read when it is first opened. */
  async function openForm() {
    setAdding(true);
    if (recipes.length > 0 || ingredients.length > 0) return;
    const [recipeList, ingredientList, placeList] = await Promise.all([
      apiJson<{ recipes: { key: string; name: string }[] }>("/api/recipes?type=batch"),
      apiJson<{
        ingredients: { id: string; name: string; baseUnit: BaseUnit; isStock: boolean }[];
      }>("/api/ingredients"),
      apiJson<{ locations: Place[] }>("/api/locations"),
    ]);
    if (recipeList.ok) setRecipes(recipeList.data.recipes);
    if (ingredientList.ok) {
      setIngredients(ingredientList.data.ingredients.filter((ingredient) => ingredient.isStock));
    }
    if (placeList.ok) {
      setPlaces(placeList.data.locations.filter((place) => place.isActive !== false));
    }
  }

  async function confirm(rule: StaffMealRuleItem, count?: number): Promise<boolean> {
    setBusy(true);
    setNote(null);
    setRowErrors((errors) => ({ ...errors, [rule.ruleId]: "" }));
    const result = await apiJson<StaffMealConfirmation>(`/api/staff-meals/${rule.ruleId}/confirm`, {
      method: "POST",
      body: count === undefined ? {} : { count },
    });
    setBusy(false);
    if (!result.ok) {
      setRowErrors((errors) => ({ ...errors, [rule.ruleId]: result.error.message }));
      // A second confirmation means somebody else just did it: show their line.
      if (result.error.code === "staff_meal_already_confirmed") await load();
      return false;
    }
    setNote(t("staffMeal.confirmed"));
    await load();
    return true;
  }

  async function toggle(rule: StaffMealRuleItem, isActive: boolean) {
    setBusy(true);
    setNote(null);
    const body =
      rule.kind === "recipe"
        ? { recipeKey: rule.targetId, defaultCount: rule.defaultCount, isActive }
        : {
            ingredientId: rule.targetId,
            defaultCount: rule.defaultCount,
            unit: rule.unit,
            ...(rule.locationId ? { locationId: rule.locationId } : {}),
            isActive,
          };
    const result = await apiJson<StaffMealRuleResult>("/api/staff-meals", { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      return setRowErrors((errors) => ({ ...errors, [rule.ruleId]: result.error.message }));
    }
    await load();
  }

  async function save(values: RuleValues): Promise<boolean> {
    setBusy(true);
    setNote(null);
    setFormError(null);
    setFormField(null);
    const body =
      values.kind === "recipe"
        ? { recipeKey: values.recipeKey, defaultCount: values.defaultCount }
        : {
            ingredientId: values.ingredientId,
            defaultCount: values.defaultCount,
            unit: values.unit,
            ...(values.locationId ? { locationId: values.locationId } : {}),
          };
    const result = await apiJson<StaffMealRuleResult>("/api/staff-meals", { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error.message);
      setFormField(ruleErrorField(result.error.code));
      return false;
    }
    setNote(t("staffMeal.saved"));
    setAdding(false);
    await load();
    return true;
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("staffMeal.title")}</Heading>
        <ErrorAlert message={t("production.forbidden")} />
      </>
    );
  }
  return (
    <>
      <Heading>{t("staffMeal.title")}</Heading>
      {data && (
        <p className="num text-ink-muted">
          {t("staffMeal.day", { date: formatCalendarDate(data.businessDate) })}
        </p>
      )}
      {note && <SuccessNote role="status">{note}</SuccessNote>}
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : data.rules.length === 0 ? (
        <Muted>{t("staffMeal.empty")}</Muted>
      ) : (
        <LedgerList>
          {data.rules.map((rule) => (
            <RuleRow
              key={rule.ruleId}
              rule={rule}
              busy={busy}
              error={rowErrors[rule.ruleId] || null}
              onConfirm={(count) => confirm(rule, count)}
              onToggle={(isActive) => void toggle(rule, isActive)}
            />
          ))}
        </LedgerList>
      )}
      <section className="flex flex-col gap-3 rounded-lg border border-rule p-3">
        <SubHeading>{t("staffMeal.rules")}</SubHeading>
        {adding ? (
          <RuleForm
            recipes={recipes}
            ingredients={ingredients}
            locations={places}
            busy={busy}
            error={formError}
            invalidField={formField}
            onSubmit={save}
          />
        ) : (
          <div>
            <Button variant="secondary" onClick={() => void openForm()}>
              {t("staffMeal.addRule")}
            </Button>
          </div>
        )}
      </section>
      <Link href="/produzione" className={`${linkClass} self-start`}>
        ← {t("production.back")}
      </Link>
    </>
  );
}
