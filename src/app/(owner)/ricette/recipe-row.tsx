import Link from "next/link";
import { Badge, LedgerRow, linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { recipeMeta, typeLabel } from "@/lib/recipes/recipe-view";
import type { RecipeSummary } from "@/server/recipes/detail";

/** One recipe of the list: the name as a link, its type, version and date, and the allergen state. */
export function RecipeRow({ recipe }: { recipe: RecipeSummary }) {
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <span className="[overflow-wrap:anywhere]">
        <Link href={`/ricette/${recipe.key}`} className={linkClass}>
          {recipe.name}
        </Link>
        {!recipe.isActive && <span className="text-ink-muted"> ({t("recipes.inactive")})</span>}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{typeLabel(recipe.type)}</Badge>
        {recipe.allergens.status !== "confirmed" && (
          <Badge tone="warning">{t("recipes.allergenTodo")}</Badge>
        )}
      </div>
      <p className="num text-sm text-ink-muted">{recipeMeta(recipe.version, recipe.validFrom)}</p>
    </LedgerRow>
  );
}
