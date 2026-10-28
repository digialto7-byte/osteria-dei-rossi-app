"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, ErrorAlert, primaryLinkClass, SubHeading } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t } from "@/lib/i18n";
import { copertoLine, coversLine, openedLine } from "@/lib/tables/table-view";
import type { TableTile } from "@/server/tables/output";
import { CoversField, readCovers } from "./covers-field";

/**
 * The open table: its covers, who opened it and when, the coperto as the server computed it (a sale charge the
 * waiter sees as it will be on the bill), "Prendi la comanda" (the order screen, M18), "Modifica coperti" and the "Conto richiesto" toggle. Any waiter may use
 * both. The toggle asks for the opposite of what the server holds; nothing is worked out here.
 */
export function SessionPanel({
  table,
  busy,
  error,
  onChangeCovers,
  onToggleBill,
  onClose,
}: {
  table: TableTile;
  busy: boolean;
  error: string | null;
  onChangeCovers: (covers: number) => void;
  onToggleBill: (requested: boolean) => void;
  onClose: () => void;
}) {
  const { session } = table;
  const [editing, setEditing] = useState(false);
  const [covers, setCovers] = useState(String(session?.covers ?? 1));
  const [localError, setLocalError] = useState<string | null>(null);
  const heading = useFocusIntoView<HTMLHeadingElement>();
  if (!session) return null;
  const coperto = copertoLine(session.coperto);

  function saveCovers() {
    const read = readCovers(covers);
    if (read === null) return setLocalError(t("tableError.covers_invalid"));
    setLocalError(null);
    setEditing(false);
    onChangeCovers(read);
  }

  return (
    <Card role="group" aria-label={table.name} className="flex flex-col gap-3">
      <SubHeading ref={heading} tabIndex={-1}>
        {table.name}
      </SubHeading>
      <div className="flex flex-col gap-1">
        <p className="num">{coversLine(session.covers)}</p>
        <p className="num text-sm text-ink-muted">
          {openedLine(session.waiter.displayName, session.openedAt, session.openedToday)}
        </p>
        {coperto && <p className="num">{coperto}</p>}
      </div>
      <Link href={`/tavoli/${session.id}`} className={`${primaryLinkClass} self-start`}>
        {t("orders.open")}
      </Link>
      {editing ? (
        <>
          <CoversField value={covers} disabled={busy} onChange={setCovers} />
          <div className="flex flex-wrap gap-3">
            <Button onClick={saveCovers} disabled={busy}>
              {t("tables.panel.saveCovers")}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setLocalError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="secondary"
          disabled={busy}
          className="self-start"
          onClick={() => {
            setCovers(String(session.covers));
            setEditing(true);
          }}
        >
          {t("tables.panel.editCovers")}
        </Button>
      )}
      <Button
        variant={session.billRequested ? "primary" : "secondary"}
        aria-pressed={session.billRequested}
        disabled={busy}
        className="self-start"
        onClick={() => onToggleBill(!session.billRequested)}
      >
        {t("tables.panel.bill")}
      </Button>
      <ErrorAlert message={localError ?? error} />
      <Button variant="quiet" onClick={onClose} className="self-start">
        {t("tables.panel.hide")}
      </Button>
    </Card>
  );
}
