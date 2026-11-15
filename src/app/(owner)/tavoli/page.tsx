"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContrastToggle, useDeviceContrast } from "@/components/contrast-toggle";
import { ErrorAlert, Heading, linkClass, Muted } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { emptyFor } from "@/lib/empty/empty-content";
import { OfflineBanner } from "@/components/sync/offline-banner";
import { SyncNotices } from "@/components/sync/sync-notices";
import { useOnline } from "@/components/use-online";
import { useMe } from "@/components/use-me";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { noticesFor } from "@/lib/sync/notices";
import { overlayTables } from "@/lib/sync/overlay-tables";
import { comandaHref } from "@/lib/tables/comanda-url";
import { saveGridScroll, takeGridScroll } from "@/lib/tables/grid-scroll";
import { canConfigureTables } from "@/lib/tables/table-view";
import { markNoticesSeen, queue, useSyncView } from "@/pwa/use-outbox";
import { TABLES_REFRESH_MS } from "@/server/tables/constants";
import type { TablesList } from "@/server/tables/output";
import { OpenTableDialog } from "./open-table-dialog";
import { TableTile } from "./table-tile";

const FORBIDDEN = 403;
const NETWORK = 0;

/**
 * The tables of the dining room for owner, admin and waiter: a grid of tiles with the server's status. An occupied tile is a link to its
 * comanda (the grid's scroll position is kept for the way back); a free one asks for the covers in a dialog. Everything comes from /api/tables, and the list is read again every 15
 * seconds while the page is visible, so a second waiter's change shows up. Opening a table is a queued operation (M20): it goes
 * into the outbox and the page moves on to the comanda of the session the phone made, offline too; a table opened on this
 * phone and not yet sent shows as open. Covers and "Conto richiesto" are changed in the comanda's header. The chef gets one notice.
 */
export default function TablesPage() {
  const router = useRouter();
  const [list, setList] = useState<TablesList | null>(null);
  // The role comes from the one cached /api/me read shared with the app shell.
  const role = useMe().me?.user.role ?? null;
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [readFailedOffline, setReadFailedOffline] = useState(false);
  const sync = useSyncView();
  const online = useOnline();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const restoredScroll = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [highContrast, setHighContrast] = useDeviceContrast();

  const load = useCallback(async () => {
    const result = await apiJson<TablesList>("/api/tables");
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setLoadError(result.error.message);
      setReadFailedOffline(result.status === NETWORK);
      return false;
    }
    setLoadError(null);
    setReadFailedOffline(false);
    // The service worker answers from its copy when there is no connection; the banner then says how old it is.
    setCachedAt(result.cachedAt ?? null);
    setList(result.data);
    return true;
  }, []);

  useEffect(() => {
    // Loading the tables when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Warms the worker's copy of the menu while there is a connection, so the comanda of a table opened offline has its dishes (M20).
    void apiJson("/api/menu");
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const timer = setInterval(refresh, TABLES_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // W2: when operations leave the outbox the server has them, so the counts on the tiles are stale; read once, not while hidden (the
  // visibility refresh above catches up when the page comes back).
  const waiting = sync.ops.length;
  const lastWaiting = useRef(waiting);
  useEffect(() => {
    if (waiting < lastWaiting.current && !document.hidden) {
      void load();
    }
    lastWaiting.current = waiting;
  }, [waiting, load]);

  function select(id: string) {
    setActionError(null);
    setSelectedId(id);
  }

  // Closing the sheet without opening: focus goes back to the tile that opened it (not every browser focuses a button on a tap).
  function cancelOpen(tableId: string) {
    setSelectedId(null);
    document.querySelector<HTMLElement>(`[data-table-id="${tableId}"]`)?.focus();
  }

  async function openTable(table: { id: string; name: string }, sessionId: string, covers: number) {
    setBusy(true);
    setActionError(null);
    try {
      await queue.queueOpenTable({ tableId: table.id, tableName: table.name, sessionId, covers });
    } catch {
      setActionError(t("common.genericError"));
      setBusy(false);
      return;
    }
    // Straight to the comanda of the session this tap made: the waiter orders right after opening (founder, 2026-10-28). Offline, the
    // client router cannot fetch the next screen, so the page is loaded in full (the service worker has it).
    if (navigator.onLine) router.push(comandaHref(sessionId));
    else window.location.assign(comandaHref(sessionId));
    setBusy(false);
  }

  // Back from a comanda: the grid returns to where it was, once, after its first render with tiles (P2b-7).
  const gridShown = list !== null;
  useEffect(() => {
    if (!gridShown || restoredScroll.current) return;
    restoredScroll.current = true;
    const offset = takeGridScroll();
    if (offset !== null) window.scrollTo(0, offset);
  }, [gridShown]);

  const shown = list === null ? null : overlayTables(list, sync.ops);
  // A table that became joined to a seated booking, or that a colleague opened, while its dialog was up is no longer openable from here.
  const selected =
    shown?.tables.find(
      (table) =>
        table.id === selectedId &&
        table.status !== "joined" &&
        (table.session === null || table.status === "closed"),
    ) ?? null;

  // The sheet went away on its own (a colleague opened the table): its focused control unmounted, so focus goes to that table's tile
  // instead of <body>. A sheet closed by the waiter already put focus back (`cancelOpen`), so nothing is taken from anyone then.
  const selectedShownId = selected?.id ?? null;
  const lastSelectedId = useRef<string | null>(null);
  useEffect(() => {
    const gone = lastSelectedId.current;
    lastSelectedId.current = selectedShownId;
    if (gone === null || selectedShownId !== null) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>(`[data-table-id="${gone}"]`)?.focus();
  }, [selectedShownId]);

  if (forbidden) {
    return (
      <>
        <Heading>{t("tables.title")}</Heading>
        <ErrorAlert message={t("tables.forbidden")} />
      </>
    );
  }

  return (
    <div
      data-sala
      data-contrast={highContrast ? "high" : undefined}
      className="flex flex-col gap-6"
    >
      <Heading>{t("tables.title")}</Heading>
      {role !== null && canConfigureTables(role) && (
        <Link href="/tavoli/impostazioni" className={`${linkClass} self-start`}>
          {t("tables.settingsLink")}
        </Link>
      )}
      <ErrorAlert message={loadError} />
      {(!online || cachedAt !== null || (readFailedOffline && list !== null)) && (
        <OfflineBanner cachedAt={cachedAt} />
      )}
      <SyncNotices
        notices={noticesFor(sync.outcomes)}
        onDismiss={(notice) => void markNoticesSeen(notice.opIds)}
      />
      {shown === null ? (
        !loadError && <Muted>{t("common.loading")}</Muted>
      ) : (
        <>
          {selected && (
            <OpenTableDialog
              key={selected.id}
              table={selected}
              busy={busy}
              error={actionError}
              onSubmit={(sessionId, covers) => void openTable(selected, sessionId, covers)}
              onCancel={() => cancelOpen(selected.id)}
            />
          )}
          {shown.tables.length === 0 ? (
            <EmptyState {...emptyFor("tables", role)} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {shown.tables.map((table) => (
                <TableTile
                  key={table.id}
                  table={table}
                  onOpen={() => select(table.id)}
                  onEnter={() => saveGridScroll(window.scrollY)}
                />
              ))}
            </div>
          )}
        </>
      )}
      <ContrastToggle high={highContrast} onToggle={setHighContrast} />
    </div>
  );
}
