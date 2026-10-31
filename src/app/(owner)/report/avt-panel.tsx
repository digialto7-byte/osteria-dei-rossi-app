import Link from "next/link";
import { LedgerList, LedgerRow, Muted, Select, linkClass } from "@/components/ui";
import { formatEur } from "@/lib/dashboard/dashboard-view";
import { t, tn } from "@/lib/i18n";
import { avtRowText, countOptionLabel, emptyText } from "@/lib/reports/report-view";
import type { AvtOutput } from "@/server/reports/output";

const COUNTS_HREF = "/magazzino/conteggi";

export type AvtState = "ok" | "noCount" | "noOpening";

/**
 * The variance view (M22 plan §3.6): actual (counted) against theoretical (recipe) consumption between two closed monthly counts, in euro. The
 * picker lists the closed monthly counts the database offers. Without two counts it says what is missing and links to the counts. With more than
 * one location the comparison is only indicative, and the screen says so.
 */
export function AvtPanel({
  avt,
  state,
  onPick,
}: {
  avt: AvtOutput | null;
  state: AvtState;
  onPick: (countId: string) => void;
}) {
  if (avt === null || state !== "ok") {
    return (
      <div className="flex flex-col gap-3">
        <Muted>{emptyText(state === "noOpening" ? "avtNoOpening" : "avtNoCount")}</Muted>
        <Link href={COUNTS_HREF} className={linkClass}>
          {t("report.avt.countsLink")}
        </Link>
      </div>
    );
  }
  const totals = avt.totals;
  const notes = [
    totals.unvaluedCount > 0 ? tn("report.avt.unvalued", totals.unvaluedCount) : null,
    totals.notCountedCount > 0 ? tn("report.avt.notCounted", totals.notCountedCount) : null,
  ].filter((note): note is string => note !== null);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[0.9375rem] font-bold text-ink">{t("report.avt.picker")}</span>
        <Select value={avt.count.id} onChange={(event) => onPick(event.target.value)}>
          {avt.availableCounts.map((count) => (
            <option key={count.id} value={count.id}>
              {countOptionLabel(count.closedAt, count.locationName)}
            </option>
          ))}
        </Select>
      </label>
      {avt.locationsActive > 1 ? <Muted>{emptyText("avtManyLocations")}</Muted> : null}
      {avt.rows.length === 0 ? (
        <Muted>{t("report.avt.rowsEmpty")}</Muted>
      ) : (
        <LedgerList>
          {avt.rows.map((row) => (
            <LedgerRow
              key={row.ingredientId}
              data-ingredient-id={row.ingredientId}
              className="py-3"
            >
              {avtRowText(row)}
            </LedgerRow>
          ))}
        </LedgerList>
      )}
      <p data-testid="avt-totals" className="font-bold tabular-nums">
        {[
          t("report.avt.totals", {
            loss: formatEur(totals.lossEur),
            gain: formatEur(totals.gainEur),
          }),
          ...notes,
        ].join(" · ")}
      </p>
    </div>
  );
}
