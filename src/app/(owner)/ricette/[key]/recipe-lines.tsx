import Link from "next/link";
import { Badge, LedgerList, LedgerRow, linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { lineQuantity, yieldText } from "@/lib/recipes/recipe-view";
import type { RecipeLine } from "@/server/recipes/detail";

/** The lines of a version: what it uses, how much, and the yield. A yield above 1 is flagged in words. */
export function RecipeLines({ lines }: { lines: RecipeLine[] }) {
  return (
    <LedgerList>
      {lines.map((line) => (
        <LedgerRow key={line.position} className="flex flex-col gap-1 py-3">
          <span className="[overflow-wrap:anywhere]">
            {line.target.kind === "recipe" ? (
              <Link href={`/ricette/${line.target.id}`} className={linkClass}>
                {line.target.name}
              </Link>
            ) : (
              <span className="font-bold">{line.target.name}</span>
            )}
          </span>
          <p className="num text-sm text-ink-muted">
            {lineQuantity(line.qty, line.unit)} · {yieldText(line.yieldFactor)}
          </p>
          {line.warnings.includes("yield_above_one") && (
            <Badge tone="warning">{t("recipes.line.yieldAbove")}</Badge>
          )}
        </LedgerRow>
      ))}
    </LedgerList>
  );
}
