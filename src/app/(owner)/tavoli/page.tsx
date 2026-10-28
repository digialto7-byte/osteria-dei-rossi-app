"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { ErrorAlert, Heading, linkClass, Muted } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { emptyFor } from "@/lib/empty/empty-content";
import { useMe } from "@/components/use-me";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { canConfigureTables } from "@/lib/tables/table-view";
import { TABLES_REFRESH_MS } from "@/server/tables/constants";
import type { TablesList } from "@/server/tables/output";
import { OpenTableDialog } from "./open-table-dialog";
import { SessionPanel } from "./session-panel";
import { TableTileButton } from "./table-tile";

const FORBIDDEN = 403;
const ALREADY_OPEN = "table_already_open";

/**
 * The tables of the dining room for owner, admin and waiter: a grid of tiles with the server's status, a dialog to
 * open a free table and a panel for an open one. Everything comes from /api/tables and is written through
 * /api/tables/:id/open and /api/table-sessions/:id; the list is read again every 15 seconds while the page is
 * visible and after each write, so a second waiter's change shows up. The chef gets one notice.
 */
export default function TablesPage() {
  const [list, setList] = useState<TablesList | null>(null);
  // The role comes from the one cached /api/me read shared with the app shell.
  const role = useMe().me?.user.role ?? null;
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiJson<TablesList>("/api/tables");
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setLoadError(result.error.message);
      return false;
    }
    setLoadError(null);
    setList(result.data);
    return true;
  }, []);

  useEffect(() => {
    // Loading the tables when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
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
    setNotice(null);
    setActionError(null);
    setSelectedId(id);
  }

  async function openTable(tableId: string, sessionId: string, covers: number) {
    setBusy(true);
    setActionError(null);
    const result = await apiJson(`/api/tables/${tableId}/open`, {
      method: "POST",
      body: { sessionId, covers },
    });
    if (result.ok) {
      setSelectedId(null);
      await load();
    } else if (result.error.code === ALREADY_OPEN) {
      // Someone else opened it first: say who (the server's words) and show the table as it is now.
      setSelectedId(null);
      setNotice(result.error.message);
      await load();
    } else {
      setActionError(result.error.message);
    }
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

  const selected = list?.tables.find((table) => table.id === selectedId) ?? null;
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
      <ErrorAlert message={loadError ?? notice} />
      {list === null ? (
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
              />
            ) : (
              <OpenTableDialog
                key={selected.id}
                table={selected}
                busy={busy}
                error={actionError}
                onSubmit={(sessionId, covers) => void openTable(selected.id, sessionId, covers)}
                onCancel={() => setSelectedId(null)}
              />
            ))}
          {list.tables.length === 0 ? (
            <EmptyState {...emptyFor("tables", role)} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {list.tables.map((table) => (
                <TableTileButton key={table.id} table={table} onSelect={() => select(table.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
