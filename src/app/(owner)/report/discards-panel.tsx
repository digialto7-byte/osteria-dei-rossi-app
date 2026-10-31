import { Button, Field, LedgerList, LedgerRow, Muted, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  discardsRowText,
  discardsTotalsText,
  emptyText,
  unmappedWeekLabel,
} from "@/lib/reports/report-view";
import { addDays } from "@/lib/time/venue-date";
import type { DiscardsOutput } from "@/server/push/output";

/**
 * The "Scarti e spinte" view (M23 plan §3.5, PRD risk "shelf life values set wrong"): the batches thrown away in an ISO week, per recipe, with how
 * many of them had a plate pushed and what they were worth. The week moves like the unmapped view's. The database counted and valued everything.
 */
export function DiscardsPanel({
  data,
  onWeek,
}: {
  data: DiscardsOutput;
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
        <Muted>{emptyText("discardsNone")}</Muted>
      ) : (
        <>
          <LedgerList>
            {data.rows.map((row) => (
              <LedgerRow key={row.recipeKey} data-recipe-key={row.recipeKey} className="py-3">
                <span className="num">{discardsRowText(row)}</span>
              </LedgerRow>
            ))}
          </LedgerList>
          <p className="num font-bold">{discardsTotalsText(data.totals)}</p>
        </>
      )}
    </div>
  );
}
