import { SubHeading } from "@/components/ui";
import { paymentTypeLabel } from "@/lib/bill/bill-view";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatTime } from "@/lib/time/format";
import type { AppVsRegister } from "@/server/day-close/output";

/** The tables closed without a receipt number on this business day, so the owner can chase them; one row per session, by its id. */
export function MissingReceipts({ rows }: { rows: AppVsRegister["missingReceipts"] }) {
  return (
    <section className="flex flex-col gap-2">
      <SubHeading>{t("dayClose.missing.title", { count: rows.length })}</SubHeading>
      {rows.length === 0 ? (
        <p className="text-ink-muted">{t("dayClose.missing.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-surface">
          {rows.map((row) => (
            <li key={row.sessionId} data-session-id={row.sessionId} className="px-3 py-2">
              {t("dayClose.missing.row", {
                table: row.tableName,
                time: formatTime(new Date(row.closedAt)),
                waiter: row.closedBy.displayName,
                amount: formatEuro(row.total),
                payment: paymentTypeLabel(row.paymentType),
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
