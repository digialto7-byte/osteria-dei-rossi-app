"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ErrorAlert, Heading, linkClass, Muted, SubHeading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { RecipeDetail } from "@/server/recipes/detail";
import { AllergenPanel } from "../../allergen-panel";
import { RecipeFacts } from "../../recipe-facts";
import { RecipeLines } from "../../recipe-lines";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** A past (or the current) version, read-only: no button, and the allergens say they use today's data. */
export default function RecipeVersionPage({
  params,
}: {
  params: Promise<{ key: string; version: string }>;
}) {
  const { key, version } = use(params);
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiJson<{ recipe: RecipeDetail }>(`/api/recipes/${key}/versions/${version}`).then(
      (result) => {
        if (cancelled) return;
        if (result.ok) setRecipe(result.data.recipe);
        else if (result.status === FORBIDDEN) setError(t("recipes.forbidden"));
        else if (result.status === NOT_FOUND) setError(t("recipes.notFound"));
        else setError(result.error.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const back = (
    <Link href={`/ricette/${key}`} className={linkClass}>
      {t("recipes.back")}
    </Link>
  );
  if (!recipe) {
    return (
      <>
        <ErrorAlert message={error} />
        {!error && <Muted>{t("common.loading")}</Muted>}
        {back}
      </>
    );
  }
  const total = recipe.versions[0]?.version ?? recipe.version;
  return (
    <>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{recipe.name}</Heading>
      </div>
      <RecipeFacts recipe={recipe} readOnly={{ total }} />
      <AllergenPanel allergens={recipe.allergens} canLink={false} historical />
      <SubHeading>{t("recipes.lines.title")}</SubHeading>
      <RecipeLines lines={recipe.lines} />
      {back}
    </>
  );
}
