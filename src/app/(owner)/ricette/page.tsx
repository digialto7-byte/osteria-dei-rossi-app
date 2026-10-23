"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Checkbox, ErrorAlert, Heading, LedgerList, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import type { TypeFilter as Filter } from "@/lib/recipes/recipe-view";
import type { RecipeSummary } from "@/server/recipes/detail";
import { RecipeRow } from "./recipe-row";
import { TypeFilter } from "./type-filter";

const FORBIDDEN = 403;

/** The screen reads /api/recipes only; the allergen state and the order come from the server. */
export default function RecipesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRequest = useRef(latestOnly()).current;

  const load = useCallback(async () => {
    const isNewest = startRequest();
    const query = new URLSearchParams({ active: showInactive ? "all" : "true" });
    if (filter !== "all") query.set("type", filter);
    const result = await apiJson<{ recipes: RecipeSummary[] }>(`/api/recipes?${query}`);
    // A slow answer for a filter the user has left must not replace the newer one.
    if (!isNewest()) return;
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setError(result.error.message);
      return;
    }
    setError(null);
    setRecipes(result.data.recipes);
  }, [filter, showInactive, startRequest]);

  useEffect(() => {
    // Loading the list when the page opens or a filter changes is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <>
        <Heading>{t("recipes.title")}</Heading>
        <ErrorAlert message={t("recipes.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("recipes.title")}</Heading>
      <div>
        <Button onClick={() => router.push("/ricette/nuova")}>{t("recipes.new")}</Button>
      </div>
      <TypeFilter value={filter} onChange={setFilter} />
      <Checkbox
        label={t("common.showInactive")}
        checked={showInactive}
        onChange={(e) => setShowInactive(e.target.checked)}
      />
      <ErrorAlert message={error} />
      {recipes === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : recipes.length === 0 ? (
        <Muted>{t("recipes.empty")}</Muted>
      ) : (
        <LedgerList>
          {recipes.map((recipe) => (
            <RecipeRow key={recipe.key} recipe={recipe} />
          ))}
        </LedgerList>
      )}
    </>
  );
}
