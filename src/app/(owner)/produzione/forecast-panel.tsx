"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CsvLink } from "@/components/csv-link";
import { Badge, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { csvHref } from "@/lib/exports/export-links";
import { latestOnly } from "@/lib/api/latest";
import { t, tn } from "@/lib/i18n";
import { coversLine, forecastLine, shortfallBadge } from "@/lib/push/push-view";
import { businessDayTitle } from "@/lib/reports/report-view";
import { formatNumber } from "@/lib/units/format";
import { FORECAST_WEEKS } from "@/server/push/constants";
import type { ForecastOutput } from "@/server/push/output";
import { BookedCovers } from "./booked-covers";

const FORBIDDEN = 403;
const PARAM = "previsione";
const TOMORROW = "domani";

type Day = "today" | "tomorrow";

function heading(day: string, weeksUsed: number): string {
  if (weeksUsed === 0) return t("forecast.heading.none", { day });
  if (weeksUsed >= FORECAST_WEEKS) return t("forecast.heading.full", { day, count: weeksUsed });
  return tn("forecast.heading.partial", weeksUsed).replace("{day}", day);
}

/**
 * The forecast of a day, above the batches (M23 plan §3.5, PRD 4.4): what the same weekday of the last four open weeks sold, next to the portions on
 * hand right now. "Oggi" and "Domani" read /api/reports/forecast; the date of "Domani" is the one the reply calls tomorrow, so nothing here computes a
 * date. The owner and the admin also see the expected covers (the chef's reply has none). The chosen day lives in the address (`?previsione=domani`).
 */
export function ForecastPanel() {
  const [day, setDay] = useState<Day>("today");
  const [data, setData] = useState<ForecastOutput | null>(null);
  const [today, setToday] = useState<{ tomorrow: string } | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useRef(latestOnly()).current;
  const tomorrow = today?.tomorrow ?? null;

  const read = useCallback(
    async (path: string, remember: boolean) => {
      const isNewest = start();
      const result = await apiJson<ForecastOutput>(path);
      if (!isNewest()) return;
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setError(null);
      setData(result.data);
      if (remember) setToday({ tomorrow: result.data.tomorrow });
    },
    [start],
  );

  useEffect(() => {
    // Opening on the day the address names, and reading the forecast, is the effect's job here.
    const wantsTomorrow = new URLSearchParams(window.location.search).get(PARAM) === TOMORROW;
    void (async () => {
      await read("/api/reports/forecast", true);
      if (wantsTomorrow) setDay("tomorrow");
    })();
  }, [read]);

  useEffect(() => {
    // Reading tomorrow's forecast when the chip is chosen is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (day === "tomorrow" && tomorrow) void read(`/api/reports/forecast?date=${tomorrow}`, false);
  }, [day, tomorrow, read]);

  function choose(next: Day) {
    setDay(next);
    const url = new URL(window.location.href);
    if (next === "tomorrow") url.searchParams.set(PARAM, TOMORROW);
    else url.searchParams.delete(PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (next === "today") void read("/api/reports/forecast", true);
  }

  if (forbidden) return null;
  if (data === null) return error ? <Muted>{error}</Muted> : null;

  const chip = (which: Day, label: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={day === which}
      disabled={disabled}
      onClick={() => choose(which)}
      className={`inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg border px-4 text-base disabled:opacity-60 ${
        day === which
          ? "border-ink bg-ink font-bold text-surface"
          : "border-rule bg-surface text-ink"
      }`}
    >
      {label}
    </button>
  );
  return (
    <section data-forecast aria-labelledby="forecast-title" className="flex flex-col gap-3">
      {error ? null : (
        <h2 id="forecast-title" className="text-[1.125rem] leading-tight font-bold text-ink">
          {heading(businessDayTitle(data.date), data.weeksUsed)}
        </h2>
      )}
      <div role="group" aria-label={t("forecast.chips.label")} className="flex gap-3">
        {chip("today", t("forecast.chip.today"))}
        {chip("tomorrow", t("forecast.chip.tomorrow"), tomorrow === null)}
      </div>
      {error ? null : (
        <div className="flex flex-wrap gap-x-4">
          <CsvLink
            href={csvHref("forecast", { date: data.date })}
            label={t("export.csv.batches")}
          />
          <CsvLink
            href={csvHref("forecast-plates", { date: data.date })}
            label={t("export.csv.plates")}
          />
        </div>
      )}
      {error ? <Muted>{error}</Muted> : <ForecastBody data={data} day={day} />}
    </section>
  );
}

function ForecastBody({ data, day }: { data: ForecastOutput; day: Day }) {
  return (
    <>
      {data.weeksUsed === 0 ? (
        <Muted>{t("forecast.empty")}</Muted>
      ) : data.batches.length === 0 ? (
        <Muted>{t("forecast.noBatches")}</Muted>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.batches.map((row) => {
            const short = shortfallBadge(row.gap);
            return (
              <li key={row.recipeKey} className="flex flex-wrap items-center gap-2">
                <span className="num">
                  {forecastLine({
                    date: data.date,
                    name: row.name,
                    expected: row.expectedPortions,
                    onHand: row.onHandPortions,
                  })}
                </span>
                {short ? <Badge tone="warning">{short}</Badge> : null}
              </li>
            );
          })}
        </ul>
      )}
      {day === "tomorrow" && data.weeksUsed > 0 ? <Muted>{t("forecast.nowNote")}</Muted> : null}
      {"covers" in data && data.covers.expected !== null ? (
        <p className="num">{coversLine(data.covers.expected)}</p>
      ) : null}
      <BookedCovers date={data.date} />
      {data.plates.length > 0 ? (
        <details>
          <summary className="min-h-tap cursor-pointer py-2 font-bold">
            {t("forecast.plates")}
          </summary>
          <ul className="flex flex-col gap-1">
            {data.plates.map((plate) => (
              <li key={plate.menuItemId} className="num">
                {plate.name} · {formatNumber(plate.expectedPlates)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
