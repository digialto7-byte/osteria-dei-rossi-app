"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorAlert, LedgerList, LedgerRow, Muted, SubHeading } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import {
  atStartText,
  dayPriceText,
  discardedAfterText,
  outcomeLine,
  platesSoldText,
  pushWindowText,
  sellDayTitle,
} from "@/lib/push/sell-through-view";
import type { PushSellThrough, PushSellThroughChef } from "@/server/push/output";
import { DayPicker } from "../chiusura/day-picker";

const FORBIDDEN = 403;

type Reply = PushSellThrough | PushSellThroughChef;

/**
 * "Com'è andata" (P2-2 spec §7.1), under today's push list: for each dish pushed on a day (yesterday to start with), the plates sold while it was
 * pushed and, for the batches that were due soon when it started, how many portions there were and what became of them. Reads
 * /api/reports/push-sell-through; with no date the server picks yesterday. The owner and the admin also read the day price, per 100 g for a dish sold
 * by weight (the unit comes from the menu); the chef's reply has none and nothing is asked for it. Every count and the percent are the API's.
 */
export function SellThroughPanel() {
  const [data, setData] = useState<Reply | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perEtto, setPerEtto] = useState<ReadonlySet<string> | null>(null);
  const start = useRef(latestOnly()).current;

  const read = useCallback(
    async (date: string | null) => {
      const isNewest = start();
      const result = await apiJson<Reply>(
        `/api/reports/push-sell-through${date ? `?date=${date}` : ""}`,
      );
      if (!isNewest()) return;
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setError(null);
      setData(result.data);
    },
    [start],
  );

  useEffect(() => {
    // Reading yesterday's push results when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void read(null);
  }, [read]);

  const showsPrice =
    data !== null && data.pushes.some((push) => "pushPrice" in push && push.pushPrice !== null);
  useEffect(() => {
    // A day price is per 100 g for a dish sold by weight: the menu says which, so it is read once, only when a price is on screen.
    if (!showsPrice || perEtto !== null) return;
    void (async () => {
      const menu = await apiJson<{ items: { id: string; priceUnit: string }[] }>("/api/menu/items");
      if (menu.ok) {
        setPerEtto(
          new Set(
            menu.data.items.filter((item) => item.priceUnit === "etto").map((item) => item.id),
          ),
        );
      }
    })();
  }, [showsPrice, perEtto]);

  if (forbidden) return null;
  return (
    <section aria-labelledby="sell-title" className="flex flex-col gap-3">
      <SubHeading id="sell-title">{t("sell.title")}</SubHeading>
      {data ? <DayPicker date={data.businessDate} onChange={(date) => void read(date)} /> : null}
      <ErrorAlert message={error} />
      {data === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : (
        <>
          <p className="text-lg font-bold">{sellDayTitle(data)}</p>
          {data.pushes.length === 0 ? (
            <Muted>{t("sell.empty")}</Muted>
          ) : (
            <>
              <LedgerList>
                {data.pushes.map((push) => {
                  const price = "pushPrice" in push ? push.pushPrice : null;
                  return (
                    <LedgerRow
                      key={`${push.menuItemId}-${push.startedAt}`}
                      className="flex flex-col gap-1 py-3"
                    >
                      <p className="flex flex-wrap justify-between gap-x-3">
                        <span className="font-bold">{push.name}</span>
                        <span className="num">{platesSoldText(push)}</span>
                      </p>
                      <p className="num text-sm text-ink-muted">
                        {pushWindowText(push)}
                        {price !== null && perEtto !== null
                          ? ` · ${dayPriceText(price, perEtto.has(push.menuItemId))}`
                          : ""}
                      </p>
                      {push.atRisk.length === 0 ? (
                        <p className="text-sm text-ink-muted">{t("sell.none")}</p>
                      ) : (
                        push.atRisk.map((row) => {
                          const after = discardedAfterText(row);
                          return (
                            <div key={row.recipeKey} className="flex flex-col pl-3">
                              <p className="font-bold">{row.name}</p>
                              <p className="num">{atStartText(row)}</p>
                              <p className="num">{outcomeLine(row)}</p>
                              {after ? <p className="num text-ink-muted">{after}</p> : null}
                            </div>
                          );
                        })
                      )}
                    </LedgerRow>
                  );
                })}
              </LedgerList>
              <Muted>{t("sell.footnote")}</Muted>
            </>
          )}
        </>
      )}
    </section>
  );
}
