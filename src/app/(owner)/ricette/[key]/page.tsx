"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorAlert,
  Heading,
  linkClass,
  Muted,
  SubHeading,
  SuccessNote,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { lineWarningText, recipeDate } from "@/lib/recipes/recipe-view";
import type { RecipeDetail } from "@/server/recipes/detail";
import { AllergenPanel } from "./allergen-panel";
import { RecipeFacts } from "./recipe-facts";
import { RecipeLines } from "./recipe-lines";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** The current version of a recipe, and the way to a new version. Reads /api/recipes/:key only. */
export default function RecipePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await apiJson<{ recipe: RecipeDetail }>(`/api/recipes/${key}`);
    if (result.ok) return setRecipe(result.data.recipe);
    if (result.status === FORBIDDEN) setMessage(t("recipes.forbidden"));
    else if (result.status === NOT_FOUND) setMessage(t("recipes.notFound"));
    else setError(result.error.message);
  }, [key]);

  useEffect(() => {
    // The save confirmation arrives as ?salvata=<version> from the form; the warnings come from the lines.
    const savedVersion = Number(new URLSearchParams(window.location.search).get("salvata"));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(Number.isInteger(savedVersion) && savedVersion > 0 ? savedVersion : null);
    void load();
  }, [load]);

  async function toggleActive(next: boolean) {
    setBusy(true);
    const result = await apiJson<{ recipe: RecipeDetail }>(`/api/recipes/${key}`, {
      method: "PATCH",
      body: { isActive: next },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setSaved(null);
    setRecipe(result.data.recipe);
  }

  if (!recipe) {
    return (
      <>
        <ErrorAlert message={message ?? error} />
        {!message && !error && <Muted>{t("common.loading")}</Muted>}
        <BackLink />
      </>
    );
  }

  const warnings =
    saved === recipe.version
      ? recipe.lines.flatMap((line) =>
          line.warnings.map((code) => ({
            key: `${line.position}-${code}`,
            text: lineWarningText(line.position, code),
          })),
        )
      : [];

  return (
    <>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{recipe.name}</Heading>
      </div>
      {saved === recipe.version && (
        <SuccessNote role="status">{t("recipes.saved", { version: recipe.version })}</SuccessNote>
      )}
      {warnings.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-6">
          {warnings.map((warning) => (
            <li key={warning.key}>{warning.text}</li>
          ))}
        </ul>
      )}
      <ErrorAlert message={error} />
      <RecipeFacts recipe={recipe} />
      <AllergenPanel allergens={recipe.allergens} canLink={recipe.canDeactivate} />
      <SubHeading>{t("recipes.lines.title")}</SubHeading>
      <RecipeLines lines={recipe.lines} />
      <SubHeading>{t("recipes.versions.title")}</SubHeading>
      <ul className="flex flex-col">
        {recipe.versions.map((version) => (
          <li key={version.version}>
            <Link href={`/ricette/${recipe.key}/versioni/${version.version}`} className={linkClass}>
              <span className="num">
                {t("recipes.versions.item", {
                  version: version.version,
                  date: recipeDate(version.validFrom),
                })}
              </span>
              {version.version === recipe.version && ` (${t("recipes.versions.current")})`}
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        {recipe.isActive && (
          <Button onClick={() => router.push(`/ricette/${recipe.key}/nuova-versione`)}>
            {t("recipes.newVersion")}
          </Button>
        )}
        {recipe.canDeactivate && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => toggleActive(!recipe.isActive)}
          >
            {recipe.isActive ? t("common.deactivate") : t("common.reactivate")}
          </Button>
        )}
      </div>
      <BackLink />
    </>
  );
}

function BackLink() {
  return (
    <Link href="/ricette" className={linkClass}>
      {t("recipes.back")}
    </Link>
  );
}
