"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "@/components/sync/offline-banner";
import { SyncNotices } from "@/components/sync/sync-notices";
import { Badge, ErrorAlert, Heading, linkClass, Muted, warningNoteClass } from "@/components/ui";
import { useMe } from "@/components/use-me";
import { useOnline } from "@/components/use-online";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { newLineId } from "@/lib/orders/line-form";
import { courseCounts, shownPrice } from "@/lib/orders/order-view";
import { noticesFor, overwrittenNotices } from "@/lib/sync/notices";
import { overlayOrder } from "@/lib/sync/overlay";
import { comandaSessionId } from "@/lib/tables/comanda-url";
import { coversLine, statusTone, statusWord } from "@/lib/tables/table-view";
import { markNoticesSeen, queue, useSyncView } from "@/pwa/use-outbox";
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import { COURSES, ORDER_REFRESH_MS, type Course, type VoidReason } from "@/server/orders/constants";
import type { OrderLine, OrderView } from "@/server/orders/output";
import { CourseTabs } from "./course-tabs";
import { LineEditor, type LineChanges } from "./line-editor";
import { MenuSection } from "./menu-section";
import { OrderSheet } from "./order-sheet";
import { PinnedStrip } from "./pinned-strip";
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
function OrderScreen({ sessionId }: { sessionId: string }) {
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

  // When operations leave the outbox the server has them: read the order at once instead of waiting for the next tick.
  const waiting = sync.ops.length;
  const lastWaiting = useRef(waiting);
  useEffect(() => {
    if (waiting < lastWaiting.current) void loadView();
    lastWaiting.current = waiting;
  }, [waiting, loadView]);

  const overlaid = overlayOrder(view, sync.ops, sessionId);
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
    const waiting = sync.ops.some((op) => op.kind === "add_line" && op.scope.lineId === line.id);
    void queued(() =>
      waiting
        ? queue.discardQueuedAdd({ sessionId, tableName, line })
        : queue.queueRemove({ sessionId, tableName, line }),
    );
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
  if (overlaid === null || menu === null) {
    return (
      <>
        {back}
        <Heading>{overlaid?.session.tableName ?? t("orders.sheet.empty")}</Heading>
        {loadError ? <ErrorAlert message={loadError} /> : <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  const { session } = overlaid;
  const notices = [
    ...noticesFor(sync.outcomes, { sessionId }),
    ...(me
      ? overwrittenNotices(sync.outcomes, view?.lines ?? [], me.user, undefined, sessionId)
      : []),
  ];
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
      {session.closed ? (
        <p role="status" className={warningNoteClass}>
          {t("orderError.session_closed")}
        </p>
      ) : (
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
      )}
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
    </>
  );
}

/** The session is in the address (`?s=<id>`): one static page serves every table, also one opened with no connection (M20 plan §3.6.4). */
function OrderRoute() {
  const sessionId = comandaSessionId(useSearchParams());
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
  return <OrderScreen key={sessionId} sessionId={sessionId} />;
}

export default function OrderPage() {
  return (
    <Suspense fallback={<Muted>{t("common.loading")}</Muted>}>
      <OrderRoute />
    </Suspense>
  );
}
