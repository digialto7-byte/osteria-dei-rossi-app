import Link from "next/link";
import { Badge, Card, linkClass } from "@/components/ui";
import {
  formatCount,
  formatLabelInstant,
  formatPortions,
  stateBadge,
  useByBadge,
} from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { BatchDetail } from "@/server/batches/types";

/**
 * The facts of a batch: lot code, what is left of what was made, when it was made and is due (Europe/Rome), where it
 * is, who made it, its state and use-by badges, the parent lot of a split part and the parts split off it. All of it
 * is what /api/batches/:id says; nothing is computed here, and there is no cost.
 */
export function BatchFacts({
  detail,
  locale = DEFAULT_LOCALE,
}: {
  detail: BatchDetail;
  locale?: Locale;
}) {
  const state = stateBadge(detail.state, locale);
  const useBy = useByBadge(detail.useByState, locale);
  const rows: Array<[string, string]> = [
    [
      t("batch.detail.portions", {}, locale),
      t(
        "batch.detail.remaining",
        {
          left: formatCount(detail.portionsRemaining, locale),
          total: formatCount(detail.portionsInitial, locale),
        },
        locale,
      ),
    ],
    [t("batch.detail.produced", {}, locale), formatLabelInstant(detail.producedAt, locale)],
    [t("batch.detail.useBy", {}, locale), formatLabelInstant(detail.useBy, locale)],
    [t("batch.detail.location", {}, locale), detail.locationName],
    [t("batch.detail.madeBy", {}, locale), detail.byInitials],
  ];
  return (
    <Card className="flex flex-col gap-3">
      {(state || useBy) && (
        <div className="flex flex-wrap gap-2">
          {state && <Badge tone={state.tone}>{state.label}</Badge>}
          {useBy && <Badge tone={useBy.tone}>{useBy.label}</Badge>}
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-ink-muted">{t("batch.detail.lot", {}, locale)}</dt>
        <dd className="num [overflow-wrap:anywhere]">{detail.lotCode}</dd>
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="num [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      {detail.splitFrom && (
        <p>
          {t("batch.detail.splitFrom", {}, locale)}{" "}
          <Link href={`/produzione/${detail.splitFrom.batchId}`} className={linkClass}>
            {detail.splitFrom.lotCode}
          </Link>
        </p>
      )}
      {detail.splits.length > 0 && (
        <div className="flex flex-col">
          <p className="font-bold">{t("batch.detail.splits", {}, locale)}</p>
          <ul className="flex flex-col">
            {detail.splits.map((part) => (
              <li key={part.batchId}>
                <Link
                  href={`/produzione/${part.batchId}`}
                  className={`${linkClass} num [overflow-wrap:anywhere]`}
                >
                  {t(
                    "batch.detail.splitLine",
                    {
                      lot: part.lotCode,
                      portions: formatPortions(part.portions, locale),
                      location: part.locationName,
                    },
                    locale,
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
