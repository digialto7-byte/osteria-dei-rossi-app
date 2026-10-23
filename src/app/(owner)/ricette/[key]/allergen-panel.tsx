import Link from "next/link";
import { Badge, linkClass, SubHeading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { allergenWords, unconfirmedLine } from "@/lib/recipes/recipe-view";
import type { AllergenSummary } from "@/server/recipes/types";

const LIST_MARK = "\u0001";

/**
 * The allergens of a recipe, derived by the database from its ingredients. Words, never colour alone.
 * Until every ingredient is confirmed the recipe says "da confermare", even with an empty list.
 */
export function AllergenPanel({
  allergens,
  canLink,
  historical = false,
}: {
  allergens: AllergenSummary;
  /** Owner and admin can open the ingredient page to fix or confirm the list. */
  canLink: boolean;
  /** A past version is shown with today's ingredient data. */
  historical?: boolean;
}) {
  const todo = allergens.status !== "confirmed";
  const [before = ""] = t("recipes.allergens.unconfirmed", { names: LIST_MARK }).split(LIST_MARK);
  return (
    <section className="flex flex-col gap-2" aria-label={t("recipes.allergens.title")}>
      <SubHeading>{t("recipes.allergens.title")}</SubHeading>
      <p className="[overflow-wrap:anywhere]">{allergenWords(allergens)}</p>
      {todo && <Badge tone="warning">{t("recipes.allergens.todo")}</Badge>}
      {allergens.unconfirmedIngredients.length > 0 &&
        (canLink ? (
          <p className="[overflow-wrap:anywhere]">
            {before}
            {allergens.unconfirmedIngredients.map((ingredient, index) => (
              <span key={ingredient.id}>
                {index > 0 && ", "}
                <Link
                  href={`/anagrafiche/ingredienti#ingredient-${ingredient.id}`}
                  className={linkClass}
                >
                  {ingredient.name}
                </Link>
              </span>
            ))}
          </p>
        ) : (
          <p className="[overflow-wrap:anywhere]">{unconfirmedLine(allergens)}</p>
        ))}
      {historical && <p className="text-sm text-ink-muted">{t("recipes.allergens.historical")}</p>}
    </section>
  );
}
