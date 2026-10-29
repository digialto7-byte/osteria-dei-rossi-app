"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
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
import { canConfigureTables } from "@/lib/tables/table-view";
import { markNoticesSeen, queue, useSyncView } from "@/pwa/use-outbox";
import { TABLES_REFRESH_MS } from "@/server/tables/constants";
import type { TablesList } from "@/server/tables/output";
import { OpenTableDialog } from "./open-table-dialog";
import { SessionPanel } from "./session-panel";
import { TableTileButton } from "./table-tile";

const FORBIDDEN = 403;
const NETWORK = 0;

/**
 * The tables of the dining room for owner, admin and waiter: a grid of tiles with the server's status, a dialog to
 * open a free table and a panel for an open one. Everything comes from /api/tables, and the list is read again every 15
 * seconds while the page is visible, so a second waiter's change shows up. Opening a table is a queued operation (M20): it goes
 * into the outbox and the page moves on to the comanda of the session the phone made, offline too; a table opened on this
 * phone and not yet sent shows as open. Covers and "Conto richiesto" change through /api/table-sessions/:id and need the
 * connection. The chef gets one notice.
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
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  function select(id: string) {
    setActionError(null);
    setSelectedId(id);
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

  async function updateSession(sessionId: string, body: object) {
    setBusy(true);
    setActionError(null);
    const result = await apiJson(`/api/table-sessions/${sessionId}`, { method: "PATCH", body });
    if (result.ok) await load();
    else setActionError(result.error.message);
    setBusy(false);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("tables.title")}</Heading>
        <ErrorAlert message={t("tables.forbidden")} />
      </>
    );
  }

  const shown = list === null ? null : overlayTables(list, sync.ops);
  const selected = shown?.tables.find((table) => table.id === selectedId) ?? null;
  const isOpenTable =
    selected !== null && selected.session !== null && selected.status !== "closed";

  return (
    <>
      <Heading>{t("tables.title")}</Heading>
      {/* The waiter has no tab bar and no section row, so this is the way out on a shared phone. */}
      {role === "waiter" && <LogoutButton className="self-start lg:hidden" />}
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
          {selected &&
            (isOpenTable ? (
              <SessionPanel
                key={selected.session!.id}
                table={selected}
                busy={busy}
                error={actionError}
                onChangeCovers={(covers) => void updateSession(selected.session!.id, { covers })}
                onToggleBill={(billRequested) =>
                  void updateSession(selected.session!.id, { billRequested })
                }
                onClose={() => setSelectedId(null)}
                offline={!online}
              />
            ) : (
              <OpenTableDialog
                key={selected.id}
                table={selected}
                busy={busy}
                error={actionError}
                onSubmit={(sessionId, covers) => void openTable(selected, sessionId, covers)}
                onCancel={() => setSelectedId(null)}
              />
            ))}
          {shown.tables.length === 0 ? (
            <EmptyState {...emptyFor("tables", role)} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {shown.tables.map((table) => (
                <TableTileButton key={table.id} table={table} onSelect={() => select(table.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
