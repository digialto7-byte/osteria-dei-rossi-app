"use client";

import { BackLink } from "@/components/back-link";
import { ErrorAlert, Heading, Muted, SuccessNote } from "@/components/ui";
import { t } from "@/lib/i18n";
import { canEditRules } from "@/lib/rules/rules-view";
import type { RecipeRulesItem } from "@/server/rules/output";
import { RecipeRuleCard, type RecipeRulesPatch } from "../recipe-rule-card";
import { useRules } from "../use-rules";

/** The prep rules of every batch recipe. Reads and writes /api/rules/recipes; where a value comes from is the server's. */
export default function RuleRecipesPage() {
  const rules = useRules<{ items: RecipeRulesItem[] }>("/api/rules/recipes");
  const canEdit = rules.role !== null && canEditRules(rules.role);

  if (rules.forbidden) {
    return (
      <>
        <Heading>{t("rules.recipes.title")}</Heading>
        <ErrorAlert message={t("rules.forbidden")} />
      </>
    );
  }
  return (
    <>
      <BackLink href="/riordino">{t("rules.back")}</BackLink>
      <Heading>{t("rules.recipes.title")}</Heading>
      <Muted>{t("rules.recipes.hint")}</Muted>
      <ErrorAlert message={rules.error} />
      {rules.saved && <SuccessNote role="status">{t("rules.saved")}</SuccessNote>}
      {rules.data === null ? (
        !rules.error && <Muted>{t("common.loading")}</Muted>
      ) : rules.data.items.length === 0 ? (
        <Muted>{t("rules.recipes.empty")}</Muted>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.data.items.map((item) => (
            <RecipeRuleCard
              key={item.recipeKey}
              item={item}
              canEdit={canEdit}
              busy={rules.busyId === item.recipeKey}
              error={rules.errors[item.recipeKey] ?? null}
              onSave={(patch: RecipeRulesPatch) =>
                void rules.save(item.recipeKey, "/api/rules/recipes", {
                  recipeKey: item.recipeKey,
                  ...patch,
                })
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
