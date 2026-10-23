import { Card } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import {
  hoursText,
  lineQuantity,
  minutesText,
  percentText,
  recipeMeta,
  typeLabel,
} from "@/lib/recipes/recipe-view";
import type { RecipeDetail } from "@/server/recipes/detail";
import { Detail, DETAIL_LIST_CLASS } from "../../fatture/detail";

const DASH = "—";

/**
 * The fact sheet of a version. Every figure comes from the API: the portion size is derived there,
 * and the prices are the menu price and the target GP% (Q16 = V6), never a cost or a margin. Rows a
 * recipe does not have are left out.
 */
export function RecipeFacts({
  recipe,
  readOnly,
}: {
  recipe: RecipeDetail;
  /** A past version: says which one it is and that it cannot be edited. */
  readOnly?: { total: number };
}) {
  const unit = recipe.outputUnit;
  const count = (value: number | null) => (value === null ? null : String(value));
  return (
    <Card className="py-1">
      {readOnly && (
        <p className="border-b border-rule py-3 font-bold">
          {t("recipes.readOnly", { version: recipe.version, total: readOnly.total })}
        </p>
      )}
      <dl className={DETAIL_LIST_CLASS}>
        <Detail label={t("recipes.fact.type")} value={typeLabel(recipe.type)} testId="fact-type" />
        <Detail
          label={t("recipes.fact.version")}
          value={recipeMeta(recipe.version, recipe.validFrom)}
          testId="fact-version"
          numeric
        />
        <Detail
          label={t(recipe.type === "batch" ? "recipes.fact.output" : "recipes.fact.outputSub")}
          value={recipe.outputQty !== null && unit ? lineQuantity(recipe.outputQty, unit) : null}
          testId="fact-output"
          numeric
        />
        <Detail
          label={t("recipes.fact.portions")}
          value={count(recipe.portionsPerBatch)}
          testId="fact-portions"
          numeric
        />
        <Detail
          label={t("recipes.fact.portionSize")}
          value={
            recipe.portionSize !== null && unit ? lineQuantity(recipe.portionSize, unit) : null
          }
          testId="fact-portion-size"
          numeric
        />
        <Detail
          label={t("recipes.fact.shelfLife")}
          value={recipe.shelfLifeHours === null ? null : hoursText(recipe.shelfLifeHours)}
          testId="fact-shelf-life"
          numeric
        />
        <Detail
          label={t("recipes.fact.prepTime")}
          value={recipe.prepTimeMin === null ? null : minutesText(recipe.prepTimeMin)}
          testId="fact-prep-time"
          numeric
        />
        <Detail
          label={t("recipes.fact.minPortions")}
          value={count(recipe.minPortions)}
          testId="fact-min-portions"
          numeric
        />
        <Detail
          label={t("recipes.fact.targetPortions")}
          value={count(recipe.targetPortions)}
          testId="fact-target-portions"
          numeric
        />
        {recipe.pricing && (
          <>
            <Detail
              label={t("recipes.fact.salePrice")}
              value={
                recipe.pricing.salePrice === null ? DASH : formatEuro(recipe.pricing.salePrice)
              }
              testId="fact-sale-price"
              numeric
            />
            <Detail
              label={t("recipes.fact.targetGp")}
              value={
                recipe.pricing.targetGpPct === null ? DASH : percentText(recipe.pricing.targetGpPct)
              }
              testId="fact-target-gp"
              numeric
            />
          </>
        )}
      </dl>
    </Card>
  );
}
