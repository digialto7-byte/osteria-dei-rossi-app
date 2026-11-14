"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  ErrorAlert,
  Field,
  LedgerList,
  LedgerRow,
  Muted,
  Select,
  SubHeading,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { addDays, venueDate } from "@/lib/time/venue-date";
import { lineHref, lineText } from "@/lib/trace/trace-view";
import type { TraceLineSearch } from "@/server/trace/output";
import { DayPicker } from "../chiusura/day-picker";
import { searchErrorText } from "./trace-errors";

const FORBIDDEN = 403;
const VOIDED = "voided";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function rememberInAddress(day: string, menuItemId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("da", "piatto");
  url.searchParams.set("giorno", day);
  if (menuItemId) url.searchParams.set("piatto", menuItemId);
  else url.searchParams.delete("piatto");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * "Da un piatto servito" (spec §3): a day (yesterday to start with) and, for the owner and the admin, one dish. Reads /api/trace/lines. The chef
 * cannot read the menu, so has no dish list and sees the whole day. No guest data: the table's name and the time only.
 */
export function LineSearch({ online, onForbidden }: { online: boolean; onForbidden: () => void }) {
  const [day, setDay] = useState("");
  const [menuItemId, setMenuItemId] = useState("");
  const [dishes, setDishes] = useState<{ id: string; name: string; active?: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TraceLineSearch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useRef(latestOnly()).current;

  const run = useCallback(
    async (date: string, dish: string) => {
      setError(null);
      rememberInAddress(date, dish);
      setLoading(true);
      const isNewest = start();
      const query = new URLSearchParams({ date });
      if (dish) query.set("menuItemId", dish);
      const reply = await apiJson<TraceLineSearch>(`/api/trace/lines?${query.toString()}`);
      if (!isNewest()) return;
      setLoading(false);
      if (reply.ok) return setResult(reply.data);
      if (reply.status === FORBIDDEN) return onForbidden();
      setResult(null);
      setError(searchErrorText(reply.error).text);
    },
    [onForbidden, start],
  );

  useEffect(() => {
    // Reading the dishes and the search named in the address, when the tab opens, is the effect's job here.
    const params = new URLSearchParams(window.location.search);
    const named = params.get("giorno");
    const dish = params.get("piatto") ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuItemId(dish);
    void (async () => {
      const menu = await apiJson<{ items: { id: string; name: string; active?: boolean }[] }>(
        "/api/menu/items",
      );
      if (menu.ok) setDishes(menu.data.items.filter((item) => item.active !== false));
    })();
    if (named && DAY.test(named)) {
      setDay(named);
      void run(named, dish);
      return;
    }
    void (async () => {
      // Yesterday's business day is the database's call (the 02:00 cut-off is tenant data): the sell-through report, asked with no date, names it.
      const yesterday = await apiJson<{ businessDate: string }>("/api/reports/push-sell-through");
      setDay(
        yesterday.ok && DAY.test(yesterday.data.businessDate)
          ? yesterday.data.businessDate
          : addDays(venueDate(new Date()), -1), // reply unavailable: the calendar day, so the form still opens
      );
    })();
  }, [run]);

  if (day === "") return null;
  return (
    <>
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (online) void run(day, menuItemId);
        }}
      >
        <DayPicker date={day} onChange={setDay} />
        {dishes.length > 0 ? (
          <Field label={t("trace.line.plate")}>
            <Select
              value={menuItemId}
              onChange={(event) => setMenuItemId(event.target.value)}
              disabled={!online}
            >
              <option value="">{t("trace.line.allPlates")}</option>
              {dishes.map((dish) => (
                <option key={dish.id} value={dish.id}>
                  {dish.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <ErrorAlert message={error} />
        {!online && <Muted>{t("trace.offline")}</Muted>}
        <Button type="submit" disabled={!online || loading}>
          {t("trace.search")}
        </Button>
      </form>
      {loading ? (
        <Muted>{t("common.loading")}</Muted>
      ) : result ? (
        <section aria-live="polite" className="flex flex-col gap-2">
          <SubHeading>{t("trace.results")}</SubHeading>
          {result.lines.length === 0 ? (
            <Muted>{t("trace.line.empty")}</Muted>
          ) : (
            <LedgerList>
              {result.lines.map((line) => (
                <LedgerRow key={line.lineId}>
                  <Link
                    href={lineHref(line.lineId)}
                    className="flex min-h-tap flex-wrap items-center gap-2 py-3"
                  >
                    <span className="num [overflow-wrap:anywhere]">{lineText(line)}</span>
                    {line.state === VOIDED ? (
                      <Badge tone="neutral">{t("trace.line.voided")}</Badge>
                    ) : null}
                  </Link>
                </LedgerRow>
              ))}
            </LedgerList>
          )}
          {result.truncated ? (
            <Muted>{t("trace.line.truncated", { count: result.lines.length })}</Muted>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
