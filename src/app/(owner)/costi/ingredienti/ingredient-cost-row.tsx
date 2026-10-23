import { Badge, Button, LedgerRow } from "@/components/ui";
import { basisLabel, ingredientFigures, nextBasis } from "@/lib/costing/cost-view";
import { t } from "@/lib/i18n";
import type { CostBasis, IngredientCost } from "@/server/costing/types";

/** One ingredient with the cost in use, its prices and the button that switches the basis. */
export function IngredientCostRow({
  ingredient,
  avgCostN,
  busy,
  onSwitch,
}: {
  ingredient: IngredientCost;
  avgCostN: number;
  busy: boolean;
  onSwitch: (basis: CostBasis) => void;
}) {
  const figures = ingredientFigures(ingredient);
  const next = nextBasis(ingredient.basis);
  const nameId = `ingredient-cost-${ingredient.id}`;
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <span id={nameId} className="font-bold [overflow-wrap:anywhere]">
        {ingredient.name}
        {!ingredient.isActive && (
          <span className="font-normal text-ink-muted"> ({t("common.inactive")})</span>
        )}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{basisLabel(ingredient.basis, avgCostN)}</Badge>
        {figures === null && <Badge tone="warning">{t("costs.ing.none")}</Badge>}
      </div>
      {figures && <p className="num text-sm text-ink-muted">{figures}</p>}
      <div>
        <Button
          variant="secondary"
          disabled={busy}
          aria-describedby={nameId}
          onClick={() => onSwitch(next.basis)}
        >
          {next.label}
        </Button>
      </div>
    </LedgerRow>
  );
}
