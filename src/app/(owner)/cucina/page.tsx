"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorAlert, Heading, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { asOfLabel, isStale } from "@/lib/kitchen/kitchen-view";
import { KITCHEN_POLL_MS } from "@/server/kitchen/constants";
import type { KitchenTickets } from "@/server/kitchen/output";
import { ContrastToggle, useKitchenContrast } from "./contrast-toggle";
import { StaleBanner } from "./stale-banner";
import { TicketCard } from "./ticket-card";

const FORBIDDEN = 403;
/** How often the stale banner is re-evaluated against the screen's own clock. */
const TICK_MS = 1_000;

/**
 * The kitchen list for chef, owner and admin (and a laptop or tablet at the pass): the dishes sent today for the open
 * tables, oldest first, from GET /api/kitchen/tickets every 5 seconds while the page is visible and at once when it comes
 * back to the front. There is no browser Supabase client (the session cookies are HttpOnly), so this is a poll, not a
 * subscription (ADR-019). A banner says when the last good read is older than a minute; the list stays below it.
 */
export default function KitchenPage() {
  const [data, setData] = useState<KitchenTickets | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(mountedAt);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [high, setHigh] = useKitchenContrast();
  const stopped = useRef(false);
  const start = useRef(latestOnly()).current;

  const load = useCallback(async () => {
    const isNewest = start();
    const result = await apiJson<KitchenTickets>("/api/kitchen/tickets");
    if (!isNewest()) return;
    if (result.ok) {
      setData(result.data);
      setLastOkAt(Date.now());
      return;
    }
    if (result.status === FORBIDDEN) {
      stopped.current = true;
      setForbidden(t("kitchen.forbidden"));
    }
    // Any other failure keeps the list on screen; the banner follows from the clock.
  }, [start]);

  useEffect(() => {
    // Loading the list when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const refresh = () => {
      if (document.hidden || stopped.current) return;
      void load();
    };
    const poll = setInterval(refresh, KITCHEN_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const stale = isStale(lastOkAt ?? mountedAt, now);
  return (
    <div
      data-kitchen
      data-layout="wide"
      data-contrast={high ? "high" : undefined}
      className="flex flex-col gap-4"
    >
      <Heading>{t("kitchen.title")}</Heading>
      {forbidden ? (
        <ErrorAlert message={forbidden} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Muted>{data ? asOfLabel(data.asOf) : t("common.loading")}</Muted>
            <ContrastToggle high={high} onToggle={setHigh} />
          </div>
          <StaleBanner stale={stale} />
          {data && data.tickets.length === 0 && <Muted>{t("kitchen.empty")}</Muted>}
          {data?.truncated && <Muted>{t("kitchen.truncated")}</Muted>}
          {data && data.tickets.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
              {data.tickets.map((ticket) => (
                <TicketCard key={ticket.key} ticket={ticket} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
