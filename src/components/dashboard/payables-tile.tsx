import Link from "next/link";
import { ROW_LINK, Tile } from "@/components/dashboard/tile";
import { LedgerList, LedgerRow, Muted } from "@/components/ui";
import { dueWords, formatEur, tileEmpty } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import type { OwnerDashboard } from "@/server/dashboard/output";

type Payables = OwnerDashboard["tiles"]["payables"];

/** Payables overdue and due within the window, with the first rows. The day words come from the server's day count. */
export function PayablesTile({ tile }: { tile: Payables }) {
  const empty = tileEmpty("payables", { payables: tile });
  return (
    <Tile
      tileKey="payables"
      title={t("dashboard.tile.payables")}
      href={tile.href}
      linkLabel={t("dashboard.link.payables")}
    >
      {empty ? (
        <Muted>{t(empty)}</Muted>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="num font-bold">
              {t("dashboard.payables.overdue", {
                count: tile.overdue.count,
                amount: formatEur(tile.overdue.amountEur),
              })}
            </p>
            <p className="num">
              {t("dashboard.payables.dueSoon", {
                days: tile.dueSoonDays,
                count: tile.dueSoon.count,
                amount: formatEur(tile.dueSoon.amountEur),
              })}
            </p>
          </div>
          <LedgerList>
            {tile.items.map((item) => (
              <LedgerRow key={item.id}>
                <Link href={item.href} className={ROW_LINK}>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-bold">{item.supplierName}</span>
                    <span className="text-ink-muted">{dueWords(item.daysToDue, item.overdue)}</span>
                  </span>
                  <span className="num shrink-0 font-bold">{formatEur(item.amountEur)}</span>
                </Link>
              </LedgerRow>
            ))}
          </LedgerList>
        </>
      )}
    </Tile>
  );
}
