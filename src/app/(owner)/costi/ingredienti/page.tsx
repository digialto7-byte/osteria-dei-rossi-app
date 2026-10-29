"use client";

import { BackLink } from "@/components/back-link";
import { useCallback, useEffect, useState } from "react";
import { useHashScroll } from "@/components/use-hash-scroll";
import { useMe } from "@/components/use-me";
import { ErrorAlert, Heading, LedgerList, Muted, SuccessNote } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { ingredientFacets } from "@/lib/nav/facet-links";
import type { IngredientCostsResponse } from "@/server/costing/ingredients";
import type { CostBasis } from "@/server/costing/types";
import { IngredientCostRow } from "./ingredient-cost-row";

const FORBIDDEN = 403;

/** Ingredient costs and the choice between the average and the last price. Reads /api/costs/ingredients. */
export default function IngredientCostsPage() {
  const [data, setData] = useState<IngredientCostsResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const role = useMe().me?.user.role ?? null;
  useHashScroll(data !== null);

  const load = useCallback(async () => {
    const result = await apiJson<IngredientCostsResponse>("/api/costs/ingredients");
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setError(result.error.message);
      return;
    }
    setError(null);
    setData(result.data);
  }, []);

  useEffect(() => {
    // Loading the list when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function switchBasis(id: string, basis: CostBasis) {
    setBusy(true);
    setSaved(false);
    const result = await apiJson(`/api/ingredients/${id}/cost-basis`, {
      method: "PUT",
      body: { basis },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setSaved(true);
    await load();
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("costs.ing.title")}</Heading>
        <ErrorAlert message={t("costError.forbidden")} />
      </>
    );
  }

  return (
    <>
      <BackLink href="/costi">{t("costs.recipe.back")}</BackLink>
      <Heading>{t("costs.ing.title")}</Heading>
      {saved && <SuccessNote role="status">{t("costs.ing.saved")}</SuccessNote>}
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : data.ingredients.length === 0 ? (
        <Muted>{t("costs.ing.empty")}</Muted>
      ) : (
        <LedgerList>
          {data.ingredients.map((ingredient) => (
            <IngredientCostRow
              key={ingredient.id}
              ingredient={ingredient}
              avgCostN={data.avgCostN}
              busy={busy}
              // The cost list holds every ingredient and does not say which are kept in stock, so it offers only the
              // record: the stock and rule screens have no row for a non-stock ingredient to land on. A deactivated one gets
              // no link, because the master list shows active ingredients by default.
              facets={
                ingredient.isActive
                  ? ingredientFacets({ id: ingredient.id, isStock: false }, role, "costs")
                  : []
              }
              onSwitch={(basis) => void switchBasis(ingredient.id, basis)}
            />
          ))}
        </LedgerList>
      )}
    </>
  );
}
