"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, ErrorAlert, Heading, linkClass, Muted, warningNoteClass } from "@/components/ui";
import { apiJson, detailObject, type ApiErrorBody } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { addBody, newLineId, patchFor, removeBody } from "@/lib/orders/line-form";
import {
  applyItemStock,
  conflictMessage,
  courseCounts,
  pendingLine,
  removeLineById,
  unavailableMessage,
  upsertLine,
  withPending,
} from "@/lib/orders/order-view";
import { coversLine, statusTone, statusWord } from "@/lib/tables/table-view";
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import { COURSES, ORDER_REFRESH_MS, type Course } from "@/server/orders/constants";
import {
  conflictDetails,
  itemUnavailableDetails,
  type AddLineOutput,
  type LineWriteOutput,
  type OrderLine,
  type OrderView,
} from "@/server/orders/output";
import type { AddLineBody } from "@/server/orders/schemas";
import { ConflictNote } from "./conflict-note";
import { CourseTabs } from "./course-tabs";
import { LineEditor, type LineChanges } from "./line-editor";
import { MenuSection } from "./menu-section";
import { OrderSheet } from "./order-sheet";
import { PinnedStrip } from "./pinned-strip";

const FORBIDDEN = 403;
const NETWORK = 0;

/** A line that has not reached the server yet: its dish and the exact body to send again. */
interface Unsent {
  item: ServiceMenuItem;
  body: AddLineBody;
}

/**
 * The order of one table ("Comanda") for owner, admin and waiter. Everything shown comes from /api/menu and
 * /api/table-sessions/:id/lines: availability, "Ne restano 3", the pinned dishes, prices, who changed a line. A tap on a
 * dish POSTs one line (the client makes the line id, so a retry is never a second line); edits PATCH one line; every
 * write carries `clientUpdatedAt`. A `conflict` reply replaces the screen's copy of the line with the server's and
 * says who changed it and when. The menu and the order are read again every 15 seconds while the page is visible.
 * The chef gets one notice.
 */
export default function OrderPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [menu, setMenu] = useState<ServiceMenu | null>(null);
  const [view, setView] = useState<OrderView | null>(null);
  const [course, setCourse] = useState<Course>(COURSES[0]);
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<OrderLine[]>([]);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ message: string; line: OrderLine | null } | null>(
    null,
  );
  const unsent = useRef(new Map<string, Unsent>());
  const discarding = useRef(new Set<string>());
  const discarded = useRef(new Set<string>());
  const [discardingIds, setDiscardingIds] = useState<ReadonlySet<string>>(new Set());
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
      return setView(result.data);
    }
    if (result.status === FORBIDDEN) return setForbidden(true);
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

  const clearNotices = () => {
    setError(null);
    setConflict(null);
  };
  const putLine = (line: OrderLine) =>
    setView((current) => current && { ...current, lines: upsertLine(current.lines, line) });

  /** Words a failed write: the dish out, the colleague's later change, the closed table, or the server's message. */
  function showFailure(failure: ApiErrorBody, name: string) {
    clearNotices();
    if (failure.code === "conflict") {
      const detail = detailObject(failure.details, conflictDetails);
      if (detail) {
        putLine(detail.line);
        setConflict({ message: conflictMessage(detail.reason, detail.line), line: detail.line });
        setEditingId(null);
        return;
      }
      setError(failure.message);
      void loadView();
      return;
    }
    if (failure.code === "item_unavailable") {
      const detail = detailObject(failure.details, itemUnavailableDetails);
      const dish = detail
        ? menu?.categories.flatMap((c) => c.items).find((i) => i.id === detail.menuItemId)?.name
        : undefined;
      setError(unavailableMessage(dish ?? name));
      void loadMenu();
      return;
    }
    setError(failure.message);
    if (failure.code === "session_closed") void loadView();
  }

  async function send(entry: Unsent, lineId: string) {
    const result = await apiJson<AddLineOutput>(`/api/table-sessions/${sessionId}/lines`, {
      method: "POST",
      body: entry.body,
    });
    if (result.ok) {
      unsent.current.delete(lineId);
      setFailedIds(new Set(unsent.current.keys()));
      setPending((current) => removeLineById(current, lineId));
      // A reply for a line the waiter has just discarded must not bring it back as a live draft.
      if (!discarded.current.has(lineId)) putLine(result.data.line);
      setMenu((current) => current && applyItemStock(current, result.data.item));
      clearNotices();
      return;
    }
    if (result.status === NETWORK) {
      // Kept as it is: "Riprova" sends the same line id and the same stamp, so the server sees one line.
      unsent.current.set(lineId, entry);
      setFailedIds(new Set(unsent.current.keys()));
      clearNotices();
      setError(result.error.message);
      return;
    }
    setPending((current) => removeLineById(current, lineId));
    showFailure(result.error, entry.item.name);
  }

  function add(item: ServiceMenuItem) {
    const lineId = newLineId();
    const body = addBody({ lineId, menuItemId: item.id, course }, new Date());
    setPending((current) => [...current, pendingLine(item, course, lineId, body.clientUpdatedAt)]);
    void send({ item, body }, lineId);
  }

  function retry(lineId: string) {
    const entry = unsent.current.get(lineId);
    if (!entry || discarding.current.has(lineId)) return;
    unsent.current.delete(lineId);
    setFailedIds(new Set(unsent.current.keys()));
    void send(entry, lineId);
  }

  /**
   * "Scarta" on a line whose send failed by network. The insert may have committed before the connection dropped, so
   * the same POST (same line id and stamp, idempotent) is replayed first: if the server has the line, it is removed
   * there (the usual removal, nothing is deleted); if the server refuses it, it never existed and goes at once; if
   * there is still no connection, the line stays marked and the waiter is told it may already have been sent.
   */
  async function discard(lineId: string) {
    const entry = unsent.current.get(lineId);
    if (!entry || discarding.current.has(lineId)) return;
    discarding.current.add(lineId);
    setDiscardingIds(new Set(discarding.current));
    try {
      const forget = () => {
        unsent.current.delete(lineId);
        setFailedIds(new Set(unsent.current.keys()));
        setPending((current) => removeLineById(current, lineId));
      };
      const unsure = () => {
        clearNotices();
        setError(t("orders.line.discardUnsure"));
      };
      const replay = await apiJson<AddLineOutput>(`/api/table-sessions/${sessionId}/lines`, {
        method: "POST",
        body: entry.body,
      });
      if (!replay.ok) {
        if (replay.status === NETWORK) return unsure();
        forget();
        return showFailure(replay.error, entry.item.name);
      }
      // The server has the line: show it as it is, so a removal that fails leaves the real line on the sheet.
      putLine(replay.data.line);
      const removal = await apiJson<LineWriteOutput>(`/api/order-lines/${lineId}/remove`, {
        method: "POST",
        body: removeBody(replay.data.line, new Date()),
      });
      if (removal.ok) {
        discarded.current.add(lineId);
        forget();
        setView(
          (current) => current && { ...current, lines: removeLineById(current.lines, lineId) },
        );
        clearNotices();
        return;
      }
      if (removal.status === NETWORK) return unsure();
      forget();
      showFailure(removal.error, entry.item.name);
    } finally {
      discarding.current.delete(lineId);
      setDiscardingIds(new Set(discarding.current));
    }
  }

  async function change(line: OrderLine, changes: LineChanges) {
    const body = patchFor(line, changes, new Date());
    if (!body) return;
    setBusyId(line.id);
    const result = await apiJson<LineWriteOutput>(`/api/order-lines/${line.id}`, {
      method: "PATCH",
      body,
    });
    setBusyId(null);
    if (result.ok) {
      putLine(result.data.line);
      clearNotices();
    } else {
      showFailure(result.error, line.name);
    }
  }

  async function remove(line: OrderLine) {
    setBusyId(line.id);
    const result = await apiJson<LineWriteOutput>(`/api/order-lines/${line.id}/remove`, {
      method: "POST",
      body: removeBody(line, new Date()),
    });
    setBusyId(null);
    if (result.ok) {
      setView(
        (current) => current && { ...current, lines: removeLineById(current.lines, line.id) },
      );
      setEditingId(null);
      clearNotices();
    } else {
      showFailure(result.error, line.name);
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
  if (view === null || menu === null) {
    return (
      <>
        {back}
        <Heading>{view?.session.tableName ?? t("orders.sheet.empty")}</Heading>
        {loadError ? <ErrorAlert message={loadError} /> : <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  const lines = withPending(view.lines, pending);
  const { session } = view;
  return (
    <>
      {back}
      <Heading>{session.tableName}</Heading>
      <div className="flex flex-wrap items-center gap-3">
        <span className="num">{coversLine(session.covers)}</span>
        <Badge tone={statusTone(session.status)}>{statusWord(session.status)}</Badge>
      </div>
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
          <ErrorAlert message={loadError ?? error} />
          {conflict && <ConflictNote message={conflict.message} line={conflict.line} />}
          <PinnedStrip items={menu.pinned} onAdd={add} />
          <MenuSection course={course} menu={menu} onAdd={add} />
        </>
      )}
      <OrderSheet
        lines={lines}
        expanded={expanded}
        onToggle={() => setExpanded((open) => !open)}
        pendingIds={new Set(pending.map((line) => line.id))}
        failedIds={failedIds}
        discardingIds={discardingIds}
        editingId={editingId}
        onEdit={(id) => setEditingId((current) => (current === id ? null : id))}
        onRetry={retry}
        onDiscard={(id) => void discard(id)}
        renderEditor={(line) => (
          <LineEditor
            key={`${line.id}-${line.clientUpdatedAt}`}
            line={line}
            busy={busyId === line.id}
            onChange={(changes) => void change(line, changes)}
            onRemove={() => void remove(line)}
            onDone={() => setEditingId(null)}
          />
        )}
      />
    </>
  );
}
