"use client";

import { useId, useState } from "react";
import { Button, Card, ErrorAlert, Field, TextInput } from "@/components/ui";
import { t, tn } from "@/lib/i18n";
import { parseWholeInput, sourceHint } from "@/lib/rules/rules-view";
import { RULES_PORTIONS_MAX, RULES_PREP_TIME_MAX } from "@/server/rules/constants";
import type { RecipeRulesItem } from "@/server/rules/output";
import { RuleFacts } from "./rule-facts";

export interface RecipeRulesPatch {
  minPortions?: number | null;
  targetPortions?: number | null;
  prepTimeMin?: number | null;
}

const text = (value: number | null) => (value === null ? "" : String(value));

/**
 * One batch recipe with its prep rules: minimum portions, target portions and preparation time. A value that comes
 * from the recipe version says so ("dalla ricetta v3"); owner and admin edit, the chef reads. It sends the fields that
 * changed, so saving never turns a version value into a rule by accident.
 */
export function RecipeRuleCard({
  item,
  canEdit,
  busy,
  error,
  onSave,
}: {
  item: RecipeRulesItem;
  canEdit: boolean;
  busy: boolean;
  error: string | null;
  onSave: (patch: RecipeRulesPatch) => void;
}) {
  const ids = [useId(), useId(), useId()];
  const [min, setMin] = useState(text(item.minPortions));
  const [target, setTarget] = useState(text(item.targetPortions));
  const [prep, setPrep] = useState(text(item.prepTimeMin));
  const [localError, setLocalError] = useState<string | null>(null);

  const fields = [
    {
      key: "minPortions" as const,
      label: t("rules.recipe.min"),
      value: min,
      set: setMin,
      current: item.minPortions,
      source: item.sources.min,
      max: RULES_PORTIONS_MAX,
      name: "min",
    },
    {
      key: "targetPortions" as const,
      label: t("rules.recipe.target"),
      value: target,
      set: setTarget,
      current: item.targetPortions,
      source: item.sources.target,
      max: RULES_PORTIONS_MAX,
      name: "target",
    },
    {
      key: "prepTimeMin" as const,
      label: t("rules.recipe.prep"),
      value: prep,
      set: setPrep,
      current: item.prepTimeMin,
      source: item.sources.prep,
      max: RULES_PREP_TIME_MAX,
      name: "prep",
    },
  ];

  function save() {
    const patch: RecipeRulesPatch = {};
    for (const field of fields) {
      const read = parseWholeInput(field.value, field.max);
      if (!read.ok) return setLocalError(t("rules.error.integer"));
      if (read.value !== field.current) patch[field.key] = read.value;
    }
    setLocalError(null);
    if (Object.keys(patch).length > 0) onSave(patch);
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-lg font-bold">{item.name}</p>
        <p className="num">{tn("rules.remaining", item.remainingPortions)}</p>
      </div>
      {canEdit ? (
        fields.map((field, index) => {
          const hint = sourceHint(field.source, item.version);
          return (
            <div key={field.key} className="flex flex-col gap-1">
              <Field label={field.label}>
                <TextInput
                  name={`${field.name}-${item.recipeKey}`}
                  type="text"
                  inputMode="numeric"
                  value={field.value}
                  disabled={busy}
                  aria-describedby={hint ? ids[index] : undefined}
                  onChange={(event) => field.set(event.target.value)}
                />
              </Field>
              {hint && (
                <span id={ids[index]} className="text-sm leading-snug text-ink-muted">
                  {hint}
                </span>
              )}
            </div>
          );
        })
      ) : (
        <RuleFacts
          rows={fields.map((field) => {
            const hint = sourceHint(field.source, item.version);
            return {
              label: field.label,
              value: (
                <>
                  {field.current === null ? t("rules.none") : String(field.current)}
                  {hint && <span className="ml-2 text-sm text-ink-muted">{hint}</span>}
                </>
              ),
            };
          })}
        />
      )}
      <ErrorAlert message={error ?? localError} />
      {canEdit && (
        <div>
          <Button variant="secondary" disabled={busy} onClick={save}>
            {t("rules.save")}
          </Button>
        </div>
      )}
    </Card>
  );
}
