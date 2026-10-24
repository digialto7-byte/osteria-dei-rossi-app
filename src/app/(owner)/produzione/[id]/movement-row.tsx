import { LedgerRow } from "@/components/ui";
import { movementLine } from "@/lib/batches/batch-view";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { BatchMovement } from "@/server/batches/types";

/**
 * One line of the batch history: what happened, the signed portions, who and when (Europe/Rome). The wording is
 * `movementLine`; there is no cost here, the chef reads this list.
 */
export function MovementRow({
  movement,
  locale = DEFAULT_LOCALE,
}: {
  movement: BatchMovement;
  locale?: Locale;
}) {
  return (
    <LedgerRow className="py-3">
      <p className="num text-sm [overflow-wrap:anywhere]">{movementLine(movement, locale)}</p>
    </LedgerRow>
  );
}
