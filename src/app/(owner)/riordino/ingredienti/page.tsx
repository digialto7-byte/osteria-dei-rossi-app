"use client";

import Link from "next/link";
import { ErrorAlert, Heading, linkClass, Muted, SuccessNote } from "@/components/ui";
import { t } from "@/lib/i18n";
import { canEditRules } from "@/lib/rules/rules-view";
import type { IngredientRulesResponse } from "@/server/rules/output";
import { IngredientRuleCard, type IngredientRulesPatch } from "../ingredient-rule-card";
import { useRules } from "../use-rules";

/**
 * The reorder rules of every stock ingredient. Reads /api/rules/ingredients and writes /api/rules/ingredients and
 * /api/counts/critical; the status, the reasons and the next window of each card are the server's.
 */
export default function RuleIngredientsPage() {
  const rules = useRules<IngredientRulesResponse>("/api/rules/ingredients");
  const canEdit = rules.role !== null && canEditRules(rules.role);

  if (rules.forbidden) {
    return (
      <>
        <Heading>{t("rules.ingredients.title")}</Heading>
        <ErrorAlert message={t("rules.forbidden")} />
      </>
    );
  }
  return (
    <>
      <Heading>{t("rules.ingredients.title")}</Heading>
      <Muted>{t("rules.ingredients.hint")}</Muted>
      <ErrorAlert message={rules.error} />
      {rules.saved && <SuccessNote role="status">{t("rules.saved")}</SuccessNote>}
      {rules.data === null ? (
        !rules.error && <Muted>{t("common.loading")}</Muted>
      ) : rules.data.items.length === 0 ? (
        <Muted>{t("rules.ingredients.empty")}</Muted>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.data.items.map((item) => (
            <IngredientRuleCard
              key={item.ingredientId}
              item={item}
              choices={rules.data?.supplierItems ?? []}
              canEdit={canEdit}
              busy={rules.busyId === item.ingredientId}
              error={rules.errors[item.ingredientId] ?? null}
              onSave={(patch: IngredientRulesPatch) =>
                void rules.save(item.ingredientId, "/api/rules/ingredients", {
                  ingredientId: item.ingredientId,
                  ...patch,
                })
              }
              onCriticalChange={(critical) =>
                void rules.save(item.ingredientId, "/api/counts/critical", {
                  ingredientId: item.ingredientId,
                  critical,
                })
              }
            />
          ))}
        </div>
      )}
      <Link href="/riordino" className={`${linkClass} self-start`}>
        ← {t("rules.back")}
      </Link>
    </>
  );
}
