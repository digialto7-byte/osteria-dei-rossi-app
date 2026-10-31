import Link from "next/link";
import { Button, Field, LedgerList, LedgerRow, Muted, TextInput, linkClass } from "@/components/ui";
import { formatEur } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import { dayAndMonth, emptyText, unmappedWeekLabel } from "@/lib/reports/report-view";
import { addDays } from "@/lib/time/venue-date";
import { formatNumber } from "@/lib/units/format";
import type { UnmappedOutput } from "@/server/reports/output";

/**
 * The unmapped view (M22 plan §3.6): what was sold in an ISO week with no recipe at the time of the sale. The week moves by a week at a time or
 * by any date; each row links to the menu, where a recipe is connected.
 */
export function UnmappedPanel({
  data,
  onWeek,
}: {
  data: UnmappedOutput;
  onWeek: (date: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-bold">{unmappedWeekLabel(data.weekFrom, data.weekTo)}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="secondary" onClick={() => onWeek(addDays(data.weekFrom, -7))}>
          {t("report.picker.previous")}
        </Button>
        <Button variant="secondary" onClick={() => onWeek(addDays(data.weekFrom, 7))}>
          {t("report.picker.next")}
        </Button>
        <Field label={t("report.picker.date")}>
          <TextInput
            type="date"
            value={data.weekFrom}
            onChange={(event) => {
              if (event.target.value) onWeek(event.target.value);
            }}
          />
        </Field>
      </div>
      {data.rows.length === 0 ? (
        <Muted>{emptyText("unmappedNone")}</Muted>
      ) : (
        <LedgerList>
          {data.rows.map((row) => (
            <LedgerRow
              key={row.menuItemId}
              data-menu-item-id={row.menuItemId}
              className="flex flex-col gap-1 py-3"
            >
              <span>
                {t("report.unmapped.row", {
                  name: row.name,
                  plates: formatNumber(row.plates),
                  amount: formatEur(row.revenueGrossEur),
                  date: dayAndMonth(row.lastSoldOn),
                })}
              </span>
              <Link href="/menu" className={linkClass}>
                {t("report.unmapped.link")}
              </Link>
            </LedgerRow>
          ))}
        </LedgerList>
      )}
    </div>
  );
}
