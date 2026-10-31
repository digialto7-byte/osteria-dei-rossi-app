import type { ReactNode } from "react";
import { BarTable, type BarRow } from "@/components/charts/bar-table";
import { Badge, Muted } from "@/components/ui";
import { formatEur, formatPct } from "@/lib/dashboard/dashboard-view";
import { differenceFigure } from "@/lib/day-close/day-close-view";
import { t } from "@/lib/i18n";
import {
  deltaWords,
  formatDelta,
  formatDeltaPct,
  formatDeltaPoints,
  hourRows,
  missingRegisterText,
  provisionalNote,
  weekdayRows,
  yesterdayHint,
} from "@/lib/reports/report-view";
import { formatCalendarDate } from "@/lib/time/format";
import type { KpiBlock, KpiReport } from "@/server/reports/output";

const DASH = "—";

type Delta = KpiReport["delta"][keyof KpiReport["delta"]];

/** "28/10/2026" or "02/11/2026 – 08/11/2026". */
function rangeText(block: KpiBlock): string {
  const from = formatCalendarDate(block.from);
  return block.to === block.from ? from : `${from} – ${formatCalendarDate(block.to)}`;
}

/** The change in words and figures; `count` shows the absolute change and the percentage, `points` the change in percentage points and the percentage, anything else the percentage only. */
function Change({
  delta,
  count = false,
  points = false,
}: {
  delta: Delta;
  count?: boolean;
  points?: boolean;
}) {
  if (delta === null) return null;
  const figure = points
    ? formatDeltaPoints(delta.abs, delta.pct)
    : count
      ? formatDelta(delta.abs, delta.pct)
      : formatDeltaPct(delta.pct);
  const words = deltaWords(delta.abs);
  const body = [figure, words].filter((part) => part !== "").join(" ");
  return body === "" ? null : <span className="text-ink-muted">{body}</span>;
}

function Kpi({
  id,
  label,
  current,
  previous,
  delta,
  count,
  points,
  children,
}: {
  id: string;
  label: string;
  current: string;
  previous: string;
  delta: Delta;
  count?: boolean;
  points?: boolean;
  children?: ReactNode;
}) {
  return (
    <li data-kpi={id} className="flex flex-col gap-1 border-b border-rule py-3 last:border-b-0">
      <span className="text-ink-muted">{label}</span>{" "}
      <div className="grid grid-cols-2 gap-x-3">
        <span className="text-[1.25rem] leading-tight font-bold tabular-nums">{current}</span>{" "}
        <span className="text-ink-muted tabular-nums">{previous}</span>
      </div>{" "}
      <Change delta={delta} count={count} points={points} />
      {children}
    </li>
  );
}

const eur = (value: number | null) => (value === null ? DASH : formatEur(value));
const pct = (value: number | null) => (value === null ? DASH : formatPct(value));

/**
 * The trend view (M22 plan §3.6): the period against its comparison period for the PRD 4.2 rows, then covers per hour and per weekday as bar
 * tables. Every figure and every change is the database's; this only prints them. Days that are not closed yet are said so.
 */
export function KpiPanel({ report }: { report: KpiReport }) {
  const { current, previous, delta } = report;
  const note = provisionalNote(current.daysFinal, current.days);
  const noRegister = [current, previous]
    .map((block) => missingRegisterText(block.appVsRegister.datesWithoutRegister))
    .filter((text): text is string => text !== null);
  const hours: BarRow[] = hourRows(current.coversByHour).map((row) => ({
    key: `h${row.hour}`,
    label: row.label,
    value: row.covers,
    valueText: String(row.covers),
  }));
  const days: BarRow[] = weekdayRows(current.coversByWeekday).map((row) => ({
    key: `d${row.index}`,
    label: row.label,
    value: row.covers,
    valueText: String(row.covers),
  }));
  const register = current.appVsRegister;
  return (
    <div className="flex flex-col gap-4">
      {note ? <Badge tone="warning">{note}</Badge> : null}
      <div className="grid grid-cols-2 gap-x-3 text-sm font-bold text-ink-muted">
        <span>
          {t("report.kpi.current")}
          <span className="block font-normal">{rangeText(current)}</span>
        </span>
        <span>
          {t("report.kpi.previous")}
          <span className="block font-normal">{rangeText(previous)}</span>
        </span>
      </div>
      <ul className="flex flex-col border-y border-rule">
        <Kpi
          id="covers"
          label={t("report.kpi.covers")}
          current={String(current.covers)}
          previous={String(previous.covers)}
          delta={delta.covers}
          count
        />
        <Kpi
          id="revenue"
          label={t("report.kpi.revenue")}
          current={formatEur(current.revenueNetEur)}
          previous={formatEur(previous.revenueNetEur)}
          delta={delta.revenueNetEur}
        />
        <Kpi
          id="spend"
          label={t("report.kpi.spend")}
          current={eur(current.avgSpendPerCoverEur)}
          previous={eur(previous.avgSpendPerCoverEur)}
          delta={delta.avgSpendPerCoverEur}
        />
        <Kpi
          id="ticket"
          label={t("report.kpi.ticket")}
          current={eur(current.avgTicketEur)}
          previous={eur(previous.avgTicketEur)}
          delta={delta.avgTicketEur}
        />
        <Kpi
          id="foodCost"
          label={t("report.kpi.foodCost")}
          current={pct(current.foodCostPct)}
          previous={pct(previous.foodCostPct)}
          delta={delta.foodCostPct}
          points
        >
          {current.foodCostPct === null ? null : (
            <Muted>{yesterdayHint(current.costedRevenueNetEur, current.revenueNetEur)}</Muted>
          )}
        </Kpi>
        <Kpi
          id="purchases"
          label={t("report.kpi.purchases")}
          current={formatEur(current.purchasesEur)}
          previous={formatEur(previous.purchasesEur)}
          delta={delta.purchasesEur}
        >
          {current.purchasesUnvaluedCount > 0 ? (
            <Muted>{t("report.kpi.unvalued", { count: current.purchasesUnvaluedCount })}</Muted>
          ) : null}
        </Kpi>
        <Kpi
          id="waste"
          label={t("report.kpi.waste")}
          current={formatEur(current.waste.valueEur)}
          previous={formatEur(previous.waste.valueEur)}
          delta={delta.wasteEur}
        >
          {current.waste.unvaluedCount > 0 ? (
            <Muted>{t("report.kpi.unvalued", { count: current.waste.unvaluedCount })}</Muted>
          ) : null}
        </Kpi>
        <li data-kpi="register" className="flex flex-col gap-1 py-3">
          <span className="text-ink-muted">{t("report.kpi.register")}</span>
          <span className="tabular-nums">
            {register.registerTotalEur === null || register.difference === null
              ? t("report.kpi.registerNone", { app: formatEur(register.appTotalEur) })
              : t("report.kpi.registerLine", {
                  app: formatEur(register.appTotalEur),
                  register: formatEur(register.registerTotalEur),
                  difference: differenceFigure(register.difference.amount, register.difference.pct),
                })}
          </span>
          {noRegister.map((text) => (
            <Muted key={text}>{text}</Muted>
          ))}
        </li>
      </ul>
      <BarTable
        caption={t("report.chart.hours")}
        rows={hours}
        max={Math.max(1, ...current.coversByHour)}
      />
      <BarTable
        caption={t("report.chart.weekdays")}
        rows={days}
        max={Math.max(1, ...current.coversByWeekday)}
      />
    </div>
  );
}
