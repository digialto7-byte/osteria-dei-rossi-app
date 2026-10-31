"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorAlert, Heading, Muted } from "@/components/ui";
import { useOnline } from "@/components/use-online";
import { apiJson, type ApiResult } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import {
  kitchenWriteBlock,
  markIntent,
  ticketMarkBody,
  undoFor,
  type Undo,
} from "@/lib/kitchen/kitchen-done";
import { asOfLabel, isStale } from "@/lib/kitchen/kitchen-view";
import { KITCHEN_POLL_MS, KITCHEN_UNDO_MS } from "@/server/kitchen/constants";
import type {
  KitchenLine,
  KitchenTicket,
  KitchenTickets,
  MarkLineReply,
  MarkTicketReply,
} from "@/server/kitchen/output";
import { ClosedSection } from "./closed-section";
import { ContrastToggle, useKitchenContrast } from "./contrast-toggle";
import { RemainingCount } from "./remaining-count";
import { StaleBanner } from "./stale-banner";
import { TicketCard } from "./ticket-card";
import { UndoNotice } from "./undo-notice";

const FORBIDDEN = 403;
const SERVER_ERROR = 500;
/** How often the stale banner is re-evaluated against the screen's own clock. */
const TICK_MS = 1_000;
/** Pending key of the "Annulla" request (a line id or a comanda key can never equal it). */
const UNDO_KEY = "undo";

/** The words for a failed write: nothing was saved when the network or the server failed; a closed table or a gone comanda reloads. */
function writeFailure(result: Extract<ApiResult<unknown>, { ok: false }>): {
  message: string;
  reload: boolean;
} {
  if (result.status === 0 || result.status >= SERVER_ERROR) {
    return { message: t("kitchen.error.notSaved"), reload: false };
  }
  if (result.error.code === "session_closed") {
    return { message: t("kitchen.error.session_closed"), reload: true };
  }
  if (result.error.code === "line_not_found" || result.error.code === "ticket_not_found") {
    return { message: t("kitchen.error.not_found"), reload: true };
  }
  return { message: result.error.message, reload: false };
}

/**
 * The kitchen screen for chef, owner and admin (and a laptop or tablet at the pass): the dishes sent today for the open tables,
 * oldest first, from GET /api/kitchen/tickets every 5 seconds while the page is visible and at once when it comes back to the
 * front. There is no browser Supabase client (the session cookies are HttpOnly), so this is a poll, not a subscription (ADR-019).
 * A banner says when the last good read is older than a minute; the list stays below it.
 *
 * M19b: a tap on a dish marks it "Fatto" (and a second tap takes it back), "Chiudi comanda" and "Riapri" close and reopen a
 * comanda, and "Annulla" takes back a close. Every write goes to /api/kitchen/* with the state wanted, and its reply carries the
 * whole board, which replaces the screen: no guess is shown and nothing is rolled back. The counts, the order and the automatic
 * close are the server's. Writes are online-only: offline or stale, the buttons are disabled and nothing is queued.
 */
export default function KitchenPage() {
  const [data, setData] = useState<KitchenTickets | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(mountedAt);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [high, setHigh] = useKitchenContrast();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [undo, setUndo] = useState<Undo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const online = useOnline();
  const stopped = useRef(false);
  const start = useRef(latestOnly()).current;
  /** `Date.now()` of the last change a tap made to each dish on this screen (the 600 ms tap guard). */
  const lastChange = useRef(new Map<string, number>());
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const showUndo = (next: Undo | null) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(next);
    if (next) undoTimer.current = setTimeout(() => setUndo(null), KITCHEN_UNDO_MS);
  };

  const mark = (key: string, on: boolean) =>
    setPending((previous) => {
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  /** Sends one write. A good reply puts its board on the screen (and makes any read that was on its way stale). */
  async function write<R extends { board: KitchenTickets }>(
    key: string,
    path: string,
    body: unknown,
  ): Promise<R | null> {
    mark(key, true);
    setProblem(null);
    const result = await apiJson<R>(path, { method: "POST", body });
    mark(key, false);
    if (!result.ok) {
      const failure = writeFailure(result);
      setProblem(failure.message);
      if (failure.reload) void load();
      return null;
    }
    start();
    setData(result.data.board);
    setLastOkAt(Date.now());
    return result.data;
  }

  const stale = isStale(lastOkAt ?? mountedAt, now);
  const block = kitchenWriteBlock({ online, stale });

  async function onTapLine(ticket: KitchenTicket, line: KitchenLine) {
    if (block) return;
    const stamp = Date.now();
    const intent = markIntent(line, {
      pending: pending.has(line.id),
      lastChangeAt: lastChange.current.get(line.id) ?? null,
      now: stamp,
    });
    if (!intent) return;
    const reply = await write<MarkLineReply>(line.id, `/api/kitchen/lines/${line.id}/mark`, intent);
    if (!reply) return;
    lastChange.current.set(line.id, Date.now());
    if (reply.reopened) showUndo(null);
    else if (reply.autoClosed) showUndo(undoFor(reply, line.id, ticket));
  }

  async function onSetTicket(ticket: KitchenTicket, closed: boolean) {
    if (block || pending.has(ticket.key)) return;
    const reply = await write<MarkTicketReply>(
      ticket.key,
      "/api/kitchen/tickets/mark",
      ticketMarkBody(ticket, closed),
    );
    if (!reply) return;
    showUndo(closed ? undoFor(reply, null, ticket) : null);
  }

  async function onUndo() {
    if (!undo || block || pending.has(UNDO_KEY)) return;
    const reply = await write<MarkLineReply | MarkTicketReply>(UNDO_KEY, undo.path, undo.body);
    if (reply) showUndo(null);
  }

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
          {data && <RemainingCount remaining={data.remaining} />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Muted>{data ? asOfLabel(data.asOf) : t("common.loading")}</Muted>
            <ContrastToggle high={high} onToggle={setHigh} />
          </div>
          <StaleBanner stale={stale} />
          {block && <Muted>{block}</Muted>}
          <ErrorAlert message={problem} />
          {data && data.tickets.length === 0 && <Muted>{t("kitchen.empty")}</Muted>}
          {data?.truncated && <Muted>{t("kitchen.truncated")}</Muted>}
          {data && data.tickets.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
              {data.tickets.map((ticket) => (
                <TicketCard
                  key={ticket.key}
                  ticket={ticket}
                  pending={pending}
                  blocked={block !== null}
                  onTapLine={(target, line) => void onTapLine(target, line)}
                  onClose={(target) => void onSetTicket(target, true)}
                />
              ))}
            </div>
          )}
          {data && (
            <ClosedSection
              tickets={data.closedTickets}
              pending={pending}
              blocked={block !== null}
              onReopen={(target) => void onSetTicket(target, false)}
            />
          )}
          <UndoNotice undo={undo} onUndo={() => void onUndo()} disabled={block !== null} />
        </>
      )}
    </div>
  );
}
