import Link from "next/link";
import { Badge, LedgerRow, linkClass } from "@/components/ui";
import { formatLabelInstantComma, useByBadge } from "@/lib/batches/batch-view";
import { t, tn } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatNumber } from "@/lib/units/format";
import type { BatchCost, BatchItem } from "@/server/batches/types";

/** A batch of the list; owner and admin get the frozen cost with it, the chef's items have none. */
export type BatchRowItem = BatchItem & { cost?: BatchCost };

/**
 * One batch: the recipe, the lot code, when it was made and is due (Europe/Rome), the portions made and left, a
 * badge once it is due soon or expired, who made it, the frozen cost for the roles that may read it, and the link to
 * the label. The use-by state and the remaining portions come from the API; nothing is computed here.
 */
export function BatchRow({
  item,
  locale = DEFAULT_LOCALE,
}: {
  item: BatchRowItem;
  locale?: Locale;
}) {
  const badge = useByBadge(item.useByState, locale);
  const who = item.byMe ? t("production.row.byMe", {}, locale) : item.byInitials;
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold [overflow-wrap:anywhere]">{item.recipeName}</p>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>
      <p className="num text-sm">{item.lotCode}</p>
      <p className="num text-sm text-ink-muted">
        {t(
          "production.row.producedUseBy",
          {
            produced: formatLabelInstantComma(item.producedAt, locale),
            useBy: formatLabelInstantComma(item.useBy, locale),
          },
          locale,
        )}
      </p>
      <p className="num text-sm">
        {tn("production.row.portions", item.portionsInitial, locale)} ·{" "}
        {t(
          "production.row.remaining",
          { count: formatNumber(item.portionsRemaining, locale) },
          locale,
        )}
        {item.portionsInitial !== item.portionsComputed && (
          <span className="text-ink-muted">
            {" "}
            {t("production.row.computed", { count: item.portionsComputed }, locale)}
          </span>
        )}{" "}
        {t("production.row.by", { who }, locale)}
      </p>
      {item.cost && (
        <p className="num text-sm">
          {item.cost.incomplete || item.cost.totalEur === null || item.cost.perPortionEur === null
            ? t("production.row.costIncomplete", {}, locale)
            : t(
                "production.row.cost",
                {
                  total: formatEuro(item.cost.totalEur, locale),
                  per: formatEuro(item.cost.perPortionEur, locale),
                },
                locale,
              )}
        </p>
      )}
      <Link href={`/produzione/${item.batchId}/etichetta`} className={`${linkClass} self-start`}>
        {t("production.row.label", {}, locale)}
      </Link>
    </LedgerRow>
  );
}
