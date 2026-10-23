"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorAlert, Heading, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import {
  emptyForm,
  formErrorsFromApi,
  formFromDetail,
  formToBody,
  type RecipeFormState,
} from "@/lib/recipes/recipe-form";
import { canEditRecipePrice } from "@/lib/recipes/recipe-view";
import type { RecipeDetail, RecipeSummary } from "@/server/recipes/detail";
import type { RecipeType } from "@/server/recipes/types";
import { RecipeForm, type IngredientOption, type RecipeOption } from "./recipe-form";

const FORBIDDEN = 403;
const CONFLICT_CODE = "version_conflict";

interface Options {
  role: string;
  ingredients: IngredientOption[];
  recipes: RecipeOption[];
}

type Props = { mode: "create" } | { mode: "version"; recipeKey: string };

/**
 * The page logic of "Nuova ricetta" and "Nuova versione": loads the choices from the API, keeps the
 * form's text, sends the body, and shows the problems the API reports. After a save it opens the
 * recipe with the confirmation.
 */
export function RecipeEditor(props: Props) {
  const router = useRouter();
  const recipeKey = props.mode === "version" ? props.recipeKey : null;
  const [options, setOptions] = useState<Options | null>(null);
  const [base, setBase] = useState<RecipeDetail | null>(null);
  const [type, setType] = useState<RecipeType>("batch");
  const [state, setState] = useState<RecipeFormState>(() => emptyForm("batch"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [me, ingredients, recipes, detail] = await Promise.all([
      apiJson<{ user: { role: string } }>("/api/me"),
      apiJson<{ ingredients: IngredientOption[] }>("/api/ingredients"),
      apiJson<{ recipes: RecipeSummary[] }>("/api/recipes"),
      recipeKey
        ? apiJson<{ recipe: RecipeDetail }>(`/api/recipes/${recipeKey}`)
        : Promise.resolve(null),
    ]);
    for (const result of [me, ingredients, recipes, detail]) {
      if (result && !result.ok) {
        return setLoadError(
          result.status === FORBIDDEN ? t("recipes.forbidden") : result.error.message,
        );
      }
    }
    if (!me.ok || !ingredients.ok || !recipes.ok) return;
    setOptions({
      role: me.data.user.role,
      ingredients: ingredients.data.ingredients,
      recipes: recipes.data.recipes.map((r) => ({ key: r.key, name: r.name, type: r.type })),
    });
    if (detail?.ok) {
      setBase(detail.data.recipe);
      setType(detail.data.recipe.type);
      setState(formFromDetail(detail.data.recipe));
    }
    setStale(false);
    setSummary(null);
    setErrors({});
  }, [recipeKey]);

  useEffect(() => {
    // Loading the choices (and the recipe to edit) when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loadError || !options || (props.mode === "version" && !base)) {
    return (
      <>
        <Heading>{t(props.mode === "create" ? "recipes.new" : "recipes.newVersion")}</Heading>
        <ErrorAlert message={loadError} />
        {!loadError && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  const canEditPrice =
    props.mode === "version" ? (base?.canEditPrice ?? false) : canEditRecipePrice(options.role);

  async function submit() {
    const built = formToBody(state, type, { canEditPrice });
    if (!built.ok) {
      setErrors(built.errors);
      return setSummary(t("recipes.form.hasFormErrors"));
    }
    setBusy(true);
    setErrors({});
    setSummary(null);
    const result =
      props.mode === "create"
        ? await apiJson<{ recipe: RecipeDetail }>("/api/recipes", {
            method: "POST",
            body: { type, ...built.body },
          })
        : await apiJson<{ recipe: RecipeDetail }>(`/api/recipes/${recipeKey}/versions`, {
            method: "POST",
            body: { baseVersion: base!.version, ...built.body },
          });
    setBusy(false);
    if (result.ok) {
      const { key, version } = result.data.recipe;
      return router.push(`/ricette/${key}?salvata=${version}`);
    }
    const problems = formErrorsFromApi(result.error);
    setErrors(problems.fields);
    setSummary(problems.summary);
    setStale(result.error.code === CONFLICT_CODE);
  }

  return (
    <>
      <Heading>{props.mode === "create" ? t("recipes.new") : t("recipes.newVersion")}</Heading>
      {base && <p className="text-ink-muted [overflow-wrap:anywhere]">{base.name}</p>}
      <RecipeForm
        type={type}
        state={state}
        onChange={setState}
        ingredients={options.ingredients}
        recipes={options.recipes}
        selfKey={recipeKey ?? undefined}
        canEditPrice={canEditPrice}
        errors={errors}
        summary={summary}
        busy={busy}
        submitLabel={t(
          props.mode === "create" ? "recipes.form.saveRecipe" : "recipes.form.saveVersion",
        )}
        onSubmit={submit}
        onCancel={() => router.push(recipeKey ? `/ricette/${recipeKey}` : "/ricette")}
        typePicker={props.mode === "create" ? { value: type, onChange: setType } : undefined}
        onReload={stale ? () => void load() : undefined}
      />
    </>
  );
}
