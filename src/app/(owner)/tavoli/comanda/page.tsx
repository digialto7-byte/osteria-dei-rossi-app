"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "@/components/sync/offline-banner";
import { SyncNotices } from "@/components/sync/sync-notices";
import { Badge, ErrorAlert, Heading, linkClass, Muted, warningNoteClass } from "@/components/ui";
import { useMe } from "@/components/use-me";
import { useOnline } from "@/components/use-online";
import { apiJson, detailObject } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { splitErrorText } from "@/lib/bill/bill-view";
import {
  closeBlock,
  closeBodyFrom,
  EMPTY_CLOSE_FORM,
  queuedCount,
  type CloseForm,
} from "@/lib/bill/close-form";
import { initialSplitForm, splitBodyFrom, type SplitForm } from "@/lib/bill/split-form";
import { t } from "@/lib/i18n";
import { newLineId } from "@/lib/orders/line-form";
import { courseCounts, shownPrice } from "@/lib/orders/order-view";
import { noticesFor, overwrittenNotices } from "@/lib/sync/notices";
import { overlayOrder } from "@/lib/sync/overlay";
import { comandaSessionId, comandaTab, type ComandaTab } from "@/lib/tables/comanda-url";
import { coversLine, statusTone, statusWord } from "@/lib/tables/table-view";
import { markNoticesSeen, queue, useSyncView } from "@/pwa/use-outbox";
import { MAX_SPLIT_PARTS, MIN_SPLIT_PARTS } from "@/server/bill/constants";
import { splitInvalidDetails, type BillOutput, type CloseOutput } from "@/server/bill/output";
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import { COURSES, ORDER_REFRESH_MS, type Course, type VoidReason } from "@/server/orders/constants";
import type { OrderLine, OrderView } from "@/server/orders/output";
import { BillSheet } from "./bill-sheet";
import { CloseSheet } from "./close-sheet";
import { CourseTabs } from "./course-tabs";
import { LineEditor, type LineChanges } from "./line-editor";
import { MenuSection } from "./menu-section";
import { OrderSheet } from "./order-sheet";
import { PinnedStrip } from "./pinned-strip";
import { SplitPanel, type SplitMode } from "./split-panel";
import { VoidDialog } from "./void-dialog";

const FORBIDDEN = 403;
const NETWORK = 0;

/**
 * The order of one table ("Comanda") for owner, admin and waiter. The menu and the order are READ from /api/menu and
 * /api/table-sessions/:id/lines (the service worker answers from its copy when there is no connection) every 15 seconds while the
 * page is visible. Every WRITE is a queued operation (M20): a tap on a dish, an edit, "Rimuovi", "Invia", "Storna" go into the
 * outbox and the replay sends them, in order, as soon as there is a connection. The sheet shows the server's lines with this
 * session's queued operations applied on top, each marked "In coda" until the server has them. What the server decided later
 * (a colleague's change, a dish that ran out, a fired line) comes back as a notice. Nothing here prices a line or computes stock.
 * The chef gets one notice.
 */
function OrderScreen({
  sessionId,
  initialTab,
}: {
  sessionId: string;
  initialTab: ComandaTab | null;
}) {
  const sync = useSyncView();
  const online = useOnline();
  const me = useMe().me;
  const [menu, setMenu] = useState<ServiceMenu | null>(null);
  const [view, setView] = useState<OrderView | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [readFailedOffline, setReadFailedOffline] = useState(false);
  const [course, setCourse] = useState<Course>(COURSES[0]);
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startMenu = useRef(latestOnly()).current;
  const startView = useRef(latestOnly()).current;
  // The bill tab (M21): the bill, the split and the close sheet. Every figure is read from /api; nothing is computed here.
  const [tab, setTab] = useState<ComandaTab | null>(initialTab);
  const [bill, setBill] = useState<BillOutput | null>(null);
  const [billError, setBillError] = useState<string | null>(null);
  const [billOffline, setBillOffline] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<SplitMode>("covers");
  const [parts, setParts] = useState<number | null>(null);
  const [form, setForm] = useState<SplitForm | null>(null);
  const [itemsSplit, setItemsSplit] = useState<BillOutput["split"]>(null);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeForm, setCloseForm] = useState<CloseForm>(EMPTY_CLOSE_FORM);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const startBill = useRef(latestOnly()).current;

  const loadMenu = useCallback(async () => {
    const isNewest = startMenu();
    const result = await apiJson<ServiceMenu>("/api/menu");
    if (!isNewest()) return;
    if (result.ok) return setMenu(result.data);
    if (result.status === FORBIDDEN) return setForbidden(true);
    setLoadError(result.error.message);
  }, [startMenu]);

  const loadView = useCallback(async () => {
    const isNewest = startView();
    const result = await apiJson<OrderView>(`/api/table-sessions/${sessionId}/lines`);
    if (!isNewest()) return;
    if (result.ok) {
      setLoadError(null);
      setReadFailedOffline(false);
      setCachedAt(result.cachedAt ?? null);
      return setView(result.data);
    }
    if (result.status === FORBIDDEN) return setForbidden(true);
    setReadFailedOffline(result.status === NETWORK);
    setLoadError(result.error.message);
  }, [sessionId, startView]);

  useEffect(() => {
    // Loading the menu and the order when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMenu();
    void loadView();
    const refresh = () => {
      if (document.hidden) return;
      void loadMenu();
      void loadView();
    };
    const timer = setInterval(refresh, ORDER_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadMenu, loadView]);

  const overlaid = overlayOrder(view, sync.ops, sessionId);
  const covers = overlaid?.session.covers ?? MIN_SPLIT_PARTS;
  // A closed table opens on its bill; a person's own choice (or ?vista=conto) wins.
  const activeTab: ComandaTab = tab ?? (overlaid?.session.closed ? "bill" : "order");
  const defaultParts = Math.min(MAX_SPLIT_PARTS, Math.max(MIN_SPLIT_PARTS, covers));
  const shownParts = parts ?? defaultParts;
  // While the split by covers is open the bill is read with ?parts=n, so the parts come back with the same token.
  const wantedParts =
    activeTab === "bill" && splitOpen && splitMode === "covers" ? shownParts : undefined;

  const loadBill = useCallback(
    async (partsWanted?: number) => {
      const isNewest = startBill();
      const query = partsWanted === undefined ? "" : `?parts=${partsWanted}`;
      const result = await apiJson<BillOutput>(`/api/table-sessions/${sessionId}/bill${query}`);
      if (!isNewest()) return;
      if (result.ok) {
        setBill(result.data);
        setBillError(null);
        return setBillOffline(false);
      }
      if (result.status === FORBIDDEN) return setForbidden(true);
      if (result.status === NETWORK) return setBillOffline(true);
      setBillError(result.error.message);
    },
    [sessionId, startBill],
  );

  useEffect(() => {
    if (activeTab !== "bill") return;
    // Reading the bill when its tab opens (and when the parts change) is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBill(wantedParts);
    const timer = setInterval(() => {
      if (!document.hidden) void loadBill(wantedParts);
    }, ORDER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [activeTab, wantedParts, loadBill]);

  // When operations leave the outbox the server has them: read the order (and the bill, if it is shown) at once instead of waiting for
  // the next tick.
  const waiting = sync.ops.length;
  const lastWaiting = useRef(waiting);
  useEffect(() => {
    if (waiting < lastWaiting.current) {
      void loadView();
      // Reading the bill after the queue emptied is the effect's job here, as for the order above.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (activeTab === "bill") void loadBill(wantedParts);
    }
    lastWaiting.current = waiting;
  }, [waiting, loadView, loadBill, activeTab, wantedParts]);

  const tableName = overlaid?.session.tableName ?? "";
  const lines = overlaid?.lines ?? [];

  /** Runs one queue call; a failure (nobody signed in, storage refused) is said in words, never swallowed. */
  async function queued(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch {
      setError(t("common.genericError"));
    }
  }

  function add(item: ServiceMenuItem) {
    void queued(() =>
      queue.queueAdd({
        sessionId,
        tableName,
        lineId: newLineId(),
        item: { id: item.id, name: item.name, unitPrice: shownPrice(item) },
        course,
      }),
    );
  }

  function change(line: OrderLine, changes: LineChanges) {
    void queued(() => queue.queueEdit({ sessionId, tableName, line, changes }));
  }

  /** "Rimuovi": a line still in the outbox is thrown away; one the server has is removed by a queued operation. */
  function remove(line: OrderLine) {
    setEditingId(null);
    void queued(() => queue.removeLine({ sessionId, tableName, line }));
  }

  /** "Scarta" on a queued add (ADR-017, outbox form): never sent, it just goes; already tried, a removal is queued after it. */
  function discard(lineId: string) {
    const line = lines.find((l) => l.id === lineId);
    if (line) void queued(() => queue.discardQueuedAdd({ sessionId, tableName, line }));
  }

  /** "Invia": queues the named lines for the kitchen, in order after whatever they depend on. The lines say "In coda per la cucina". */
  function sendLines(ids: string[]) {
    void queued(() => queue.queueFire({ sessionId, tableName, lineIds: ids }));
  }

  /** "Storna piatto" on a sent line: a coded reason; the line stays on the sheet and says "Storno in coda". */
  function voidSent(line: OrderLine, reason: VoidReason) {
    setVoidingId(null);
    void queued(() => queue.queueVoid({ sessionId, tableName, line, reason }));
  }

  const splitForm = form ?? initialSplitForm(covers);

  /** "Calcola": the split by dishes is computed by the server from the ids the waiter assigned. */
  async function calculateSplit() {
    setSplitBusy(true);
    setSplitError(null);
    const result = await apiJson<BillOutput>(`/api/table-sessions/${sessionId}/bill/split`, {
      method: "POST",
      body: splitBodyFrom(splitForm),
    });
    setSplitBusy(false);
    if (result.ok) {
      setBill(result.data);
      return setItemsSplit(result.data.split);
    }
    if (result.status === NETWORK) return setSplitError(t("bill.offline"));
    if (result.error.code === "split_invalid") {
      const detail = detailObject(result.error.details, splitInvalidDetails);
      return setSplitError(splitErrorText(detail?.reason, covers));
    }
    setSplitError(result.error.message);
  }

  /** "Chiudi tavolo": one POST with the token of the bill the waiter is looking at. A refusal is said in words and the bill is read again. */
  async function submitClose() {
    if (!bill) return;
    const body = closeBodyFrom(closeForm, bill.billToken);
    if (!body) return;
    setCloseBusy(true);
    setCloseError(null);
    const result = await apiJson<CloseOutput>(`/api/table-sessions/${sessionId}/close`, {
      method: "POST",
      body,
    });
    setCloseBusy(false);
    if (result.ok) {
      setBill(result.data.bill);
      setCloseOpen(false);
      setSplitOpen(false);
      setCloseForm(EMPTY_CLOSE_FORM);
      setTab("bill");
      return void loadView();
    }
    if (result.status === NETWORK) return setCloseError(t("bill.closeBlock.offline"));
    setCloseError(result.error.message);
    if (["bill_changed", "unsent_lines", "session_closed"].includes(result.error.code)) {
      void loadBill(wantedParts);
      if (result.error.code === "session_closed") void loadView();
    }
  }

  const back = (
    <Link href="/tavoli" className={`${linkClass} self-start`}>
      {t("orders.back")}
    </Link>
  );

  if (forbidden) {
    return (
      <>
        {back}
        <Heading>{t("orders.sheet.empty")}</Heading>
        <ErrorAlert message={t("orders.forbidden")} />
      </>
    );
  }
  // What the server decided about this table's operations is told here too, also when the table itself is gone (a colleague opened it
  // first: the read says "not found" and only the notice explains why).
  const notices = [
    ...noticesFor(sync.outcomes, { sessionId }),
    ...(me
      ? overwrittenNotices(sync.outcomes, view?.lines ?? [], me.user, undefined, sessionId)
      : []),
  ];
  if (overlaid === null || menu === null) {
    return (
      <>
        {back}
        <Heading>{overlaid?.session.tableName ?? t("orders.sheet.empty")}</Heading>
        <SyncNotices notices={notices} onDismiss={(notice) => void markNoticesSeen(notice.opIds)} />
        {loadError ? <ErrorAlert message={loadError} /> : <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  const { session } = overlaid;
  const showOffline = !online || cachedAt !== null || readFailedOffline;
  // A read that failed for a session only this phone knows (its open is still queued) is no news: the banner says offline.
  const readError = view === null ? null : loadError;
  return (
    <>
      {back}
      <Heading>{session.tableName}</Heading>
      <div className="flex flex-wrap items-center gap-3">
        <span className="num">{coversLine(session.covers)}</span>
        <Badge tone={statusTone(session.status)}>{statusWord(session.status)}</Badge>
      </div>
      {showOffline && <OfflineBanner cachedAt={cachedAt} />}
      <SyncNotices notices={notices} onDismiss={(notice) => void markNoticesSeen(notice.opIds)} />
      <div role="tablist" aria-label={t("bill.tabs.label")} className="flex gap-2">
        {(["order", "bill"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`view-${value}`}
            aria-selected={activeTab === value}
            onClick={() => setTab(value)}
            className={
              "min-h-tap flex-1 rounded-lg px-3 text-base font-bold transition-colors duration-150 " +
              (activeTab === value
                ? "bg-accent text-on-accent"
                : "border border-rule-strong bg-surface text-ink hover:bg-sunk")
            }
          >
            {t(value === "order" ? "bill.tab.order" : "bill.tab.bill")}
          </button>
        ))}
      </div>
      {session.closed && (
        <p role="status" className={warningNoteClass}>
          {t("orderError.session_closed")}
        </p>
      )}
      {activeTab === "bill" ? (
        <div role="tabpanel" aria-labelledby="view-bill" className="flex flex-col gap-4">
          {billOffline ? (
            <p role="status" className="text-ink-muted">
              {t("bill.offline")}
            </p>
          ) : bill === null ? (
            billError ? (
              <ErrorAlert message={billError} />
            ) : (
              <Muted>{t("bill.loading")}</Muted>
            )
          ) : (
            <>
              <ErrorAlert message={billError} />
              <BillSheet
                bill={bill}
                onBack={() => setTab("order")}
                onClose={() => {
                  setCloseOpen(true);
                  setSplitOpen(false);
                }}
                onSplit={() => {
                  setSplitOpen(true);
                  setCloseOpen(false);
                }}
              />
              {splitOpen && !bill.closed && (
                <SplitPanel
                  mode={splitMode}
                  onMode={(next) => {
                    setSplitMode(next);
                    setSplitError(null);
                  }}
                  lines={bill.lines}
                  covers={covers}
                  parts={shownParts}
                  onParts={setParts}
                  split={
                    splitMode === "covers"
                      ? bill.split?.mode === "covers"
                        ? bill.split
                        : null
                      : itemsSplit
                  }
                  form={splitForm}
                  onForm={(next) => {
                    setForm(next);
                    setItemsSplit(null);
                  }}
                  onCalculate={() => void calculateSplit()}
                  busy={splitBusy}
                  error={splitError}
                />
              )}
              {closeOpen && !bill.closed && (
                <CloseSheet
                  total={bill.total}
                  form={closeForm}
                  onForm={setCloseForm}
                  block={closeBlock(sync, sessionId, billOffline)}
                  queuedCount={queuedCount(sync, sessionId)}
                  busy={closeBusy}
                  error={closeError}
                  onSubmit={() => void submitClose()}
                  onCancel={() => setCloseOpen(false)}
                />
              )}
            </>
          )}
        </div>
      ) : (
        !session.closed && (
          <>
            <CourseTabs
              selected={course}
              counts={courseCounts(lines)}
              onSelect={(next) => setCourse(next)}
            />
            <ErrorAlert message={readError ?? error} />
            <PinnedStrip items={menu.pinned} onAdd={add} />
            <MenuSection course={course} menu={menu} onAdd={add} />
          </>
        )
      )}
      {activeTab === "order" && (
        <OrderSheet
          lines={lines}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
          editingId={editingId}
          onEdit={(id) => setEditingId((current) => (current === id ? null : id))}
          onSend={sendLines}
          voidingId={voidingId}
          onVoid={(id) => setVoidingId((current) => (current === id ? null : id))}
          renderVoid={(line) => (
            <VoidDialog
              line={line}
              busy={false}
              onConfirm={(reason) => voidSent(line, reason)}
              onCancel={() => setVoidingId(null)}
            />
          )}
          onDiscard={discard}
          renderEditor={(line) => (
            <LineEditor
              key={`${line.id}-${line.clientUpdatedAt}`}
              line={line}
              busy={false}
              onChange={(changes) => change(line, changes)}
              onRemove={() => remove(line)}
              onDone={() => setEditingId(null)}
            />
          )}
        />
      )}
    </>
  );
}

/** The session is in the address (`?s=<id>`): one static page serves every table, also one opened with no connection (M20 plan §3.6.4). */
function OrderRoute() {
  const params = useSearchParams();
  const sessionId = comandaSessionId(params);
  if (!sessionId) {
    return (
      <div className="flex flex-col gap-3">
        <Heading>{t("orders.sessionMissing")}</Heading>
        <Link href="/tavoli" className={linkClass}>
          {t("orders.back")}
        </Link>
      </div>
    );
  }
  return <OrderScreen key={sessionId} sessionId={sessionId} initialTab={comandaTab(params)} />;
}

export default function OrderPage() {
  return (
    <Suspense fallback={<Muted>{t("common.loading")}</Muted>}>
      <OrderRoute />
    </Suspense>
  );
}
