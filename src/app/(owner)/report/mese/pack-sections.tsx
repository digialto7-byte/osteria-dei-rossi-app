import { LedgerList, LedgerRow, Muted, SubHeading } from "@/components/ui";
import { formatEur, formatPct } from "@/lib/dashboard/dashboard-view";
import { differenceFigure } from "@/lib/day-close/day-close-view";
import { t, tn } from "@/lib/i18n";
import {
  avtRowText,
  monthLabel,
  packCountPair,
  packFigureLine,
  wasteBatchLineText,
  wasteRawLineText,
  type PackKind,
} from "@/lib/reports/report-view";
import { reasonLabel } from "@/server/stock/reasons";
import type { MonthlyPack } from "@/server/exports/pack-output";

const DASH = "—";

type Delta = { abs: number; pct: number | null } | null;

/**
 * The four sections of the monthly pack (M24 plan §3.5), printed on A4 by the browser. The server composed the pack and chose the state of the
 * variance; this only formats what it was given. No amount is added, divided or rounded here.
 */
export function PackSections({ pack }: { pack: MonthlyPack }) {
  const { kpis, waste, variance } = pack;
  const { current, previous, delta } = kpis;
  const previousMonth = monthLabel(pack.previousMonth);
  const month = monthLabel(pack.month);

  const money = (value: number | null) => (value === null ? DASH : formatEur(value));
  const percent = (value: number | null) => (value === null ? DASH : formatPct(value));
  const line = (
    id: string,
    label: string,
    now: string,
    before: string,
    change: Delta,
    kind: PackKind,
  ) => (
    <li key={id} data-kpi={id} className="border-b border-rule py-2 tabular-nums last:border-b-0">
      {packFigureLine(
        { label, current: now, previous: before, delta: change, kind },
        previousMonth,
      )}
    </li>
  );
  const register = current.appVsRegister;

  return (
    <>
      <section aria-labelledby="pack-indicators" className="flex flex-col gap-2">
        <SubHeading id="pack-indicators">{t("pack.section.indicators")}</SubHeading>
        <ul className="flex flex-col border-y border-rule">
          {line(
            "covers",
            t("report.kpi.covers"),
            String(current.covers),
            String(previous.covers),
            delta.covers,
            "count",
          )}
          {line(
            "tables",
            t("pack.kpi.tables"),
            String(current.tables),
            String(previous.tables),
            delta.tables,
            "count",
          )}
          {line(
            "revenue",
            t("report.kpi.revenue"),
            formatEur(current.revenueNetEur),
            formatEur(previous.revenueNetEur),
            delta.revenueNetEur,
            "pct",
          )}
          {line(
            "spend",
            t("report.kpi.spend"),
            money(current.avgSpendPerCoverEur),
            money(previous.avgSpendPerCoverEur),
            delta.avgSpendPerCoverEur,
            "pct",
          )}
          {line(
            "ticket",
            t("report.kpi.ticket"),
            money(current.avgTicketEur),
            money(previous.avgTicketEur),
            delta.avgTicketEur,
            "pct",
          )}
          {line(
            "plates",
            t("pack.kpi.plates"),
            String(current.plates),
            String(previous.plates),
            delta.plates,
            "count",
          )}
          {line(
            "foodCost",
            t("report.kpi.foodCost"),
            percent(current.foodCostPct),
            percent(previous.foodCostPct),
            delta.foodCostPct,
            "points",
          )}
          <li data-kpi="register" className="py-2 tabular-nums">
            {register.registerTotalEur === null || register.difference === null
              ? t("report.kpi.registerNone", { app: formatEur(register.appTotalEur) })
              : `${t("report.kpi.register")}: ${t("report.kpi.registerLine", {
                  app: formatEur(register.appTotalEur),
                  register: formatEur(register.registerTotalEur),
                  difference: differenceFigure(register.difference.amount, register.difference.pct),
                })}`}
          </li>
        </ul>
      </section>

      <section aria-labelledby="pack-purchases" className="flex flex-col gap-2">
        <SubHeading id="pack-purchases">{t("pack.section.purchases")}</SubHeading>
        <p className="tabular-nums">
          {packFigureLine(
            {
              label: t("pack.purchases.label"),
              current: formatEur(current.purchasesEur),
              previous: formatEur(previous.purchasesEur),
              delta: delta.purchasesEur,
              kind: "eur",
            },
            previousMonth,
          )}
        </p>
        {current.purchasesUnvaluedCount > 0 ? (
          <Muted>{tn("pack.purchases.unvalued", current.purchasesUnvaluedCount)}</Muted>
        ) : null}
      </section>

      <section aria-labelledby="pack-waste" className="flex flex-col gap-2">
        <SubHeading id="pack-waste">{t("pack.section.waste")}</SubHeading>
        <p className="font-bold tabular-nums">
          {t("pack.waste.total", { value: formatEur(waste.valueEur) })}
          {waste.unvaluedCount > 0
            ? ` · ${t("pack.waste.unvalued", { count: waste.unvaluedCount })}`
            : ""}
        </p>
        {waste.reasons.length === 0 ? (
          <Muted>{t("pack.waste.none", { month })}</Muted>
        ) : (
          <LedgerList>
            {waste.reasons.map((reason) => (
              <LedgerRow
                key={reason.reasonCode}
                data-reason={reason.reasonCode}
                className="flex flex-col gap-1 py-2"
              >
                <p className="font-bold tabular-nums">
                  {reasonLabel(reason.reasonCode)} · {formatEur(reason.valueEur)}
                </p>
                {reason.lines.map((l) => (
                  <p key={l.ingredientId} className="text-sm tabular-nums [overflow-wrap:anywhere]">
                    {wasteRawLineText(l)}
                  </p>
                ))}
                {reason.batchLines.map((l) => (
                  <p
                    key={`${l.recipeKey}-${l.recipeName}`}
                    className="text-sm tabular-nums [overflow-wrap:anywhere]"
                  >
                    {wasteBatchLineText(l)}
                  </p>
                ))}
              </LedgerRow>
            ))}
          </LedgerList>
        )}
      </section>

      <section aria-labelledby="pack-variance" className="flex flex-col gap-2">
        <SubHeading id="pack-variance">{t("pack.section.variance")}</SubHeading>
        {variance.state === "noCount" ? (
          <Muted>{t("pack.variance.noCount", { month })}</Muted>
        ) : null}
        {variance.state === "noOpening" ? <Muted>{t("pack.variance.noOpening")}</Muted> : null}
        {variance.state === "ok" ? <Variance avt={variance.avt} /> : null}
      </section>
    </>
  );
}

function Variance({ avt }: { avt: Extract<MonthlyPack["variance"], { state: "ok" }>["avt"] }) {
  const totals = avt.totals;
  const notes = [
    totals.unvaluedCount > 0 ? tn("report.avt.unvalued", totals.unvaluedCount) : null,
    totals.notCountedCount > 0 ? tn("report.avt.notCounted", totals.notCountedCount) : null,
  ].filter((note): note is string => note !== null);
  return (
    <>
      <p className="text-ink-muted">{packCountPair(avt)}</p>
      {avt.rows.length === 0 ? (
        <Muted>{t("report.avt.rowsEmpty")}</Muted>
      ) : (
        <LedgerList>
          {avt.rows.map((row) => (
            <LedgerRow
              key={row.ingredientId}
              data-ingredient-id={row.ingredientId}
              className="py-2"
            >
              {avtRowText(row)}
            </LedgerRow>
          ))}
        </LedgerList>
      )}
      <p className="font-bold tabular-nums">
        {[
          t("report.avt.totals", {
            loss: formatEur(totals.lossEur),
            gain: formatEur(totals.gainEur),
          }),
          ...notes,
        ].join(" · ")}
      </p>
    </>
  );
}
