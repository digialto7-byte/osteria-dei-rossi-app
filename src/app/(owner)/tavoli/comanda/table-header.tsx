"use client";

import { useId, useState } from "react";
import { Badge, Button, Card, ErrorAlert, Heading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { coversLine, statusTone, statusWord } from "@/lib/tables/table-view";
import type { OrderView } from "@/server/orders/output";
import { CoversField, readCovers } from "../covers-field";

type Session = Pick<
  OrderView["session"],
  "tableName" | "covers" | "status" | "billRequested" | "closed"
>;

/** A write the page makes: the PATCH, then one read of the order. It answers the refusal's words, or null when it went through. */
type Write<A> = (argument: A) => Promise<string | null>;

/**
 * The comanda's header (Direct comanda, docs/ux/p3-sala-waiter.md §10.2-§10.3, with the lead's change of 2026-11-14), top to bottom:
 * the table's name with the "Tavolo ▾" disclosure; the status badge with the "Conto richiesto" toggle; the meta line.
 * - "Conto richiesto" is a pressed secondary, one tap, never the primary (QW11): the bar's "Invia" is the screen's one primary. It asks for
 *   the opposite of what the server holds; nothing is worked out here.
 * - "Tavolo ▾" opens a card in place, under the header, with "Modifica coperti". It is not a modal.
 * - Both need the server (M20, Q123): offline they are off and one sentence says why. A closed table has neither.
 * - The meta line is the covers only until the order carries the opener and the coperto (plan D17); no placeholder stands in for them.
 */
export function TableHeader({
  session,
  offline,
  onChangeCovers,
  onToggleBill,
}: {
  session: Session;
  offline: boolean;
  onChangeCovers: Write<number>;
  onToggleBill: Write<boolean>;
}) {
  const cardId = useId();
  const [open, setOpen] = useState(false);
  const [covers, setCovers] = useState(String(session.covers));
  const [busy, setBusy] = useState(false);
  const [billError, setBillError] = useState<string | null>(null);
  const [coversError, setCoversError] = useState<string | null>(null);

  async function toggleBill() {
    if (busy) return;
    setBusy(true);
    setBillError(null);
    setBillError(await onToggleBill(!session.billRequested));
    setBusy(false);
  }

  async function saveCovers() {
    if (busy) return;
    const read = readCovers(covers);
    if (read === null) return setCoversError(t("tableError.covers_invalid"));
    setBusy(true);
    setCoversError(null);
    const refusal = await onChangeCovers(read);
    setCoversError(refusal);
    setBusy(false);
    if (refusal === null) setOpen(false);
  }

  function toggleCard() {
    if (!open) setCovers(String(session.covers));
    setCoversError(null);
    setOpen(!open);
  }

  const off = busy || offline;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Heading>{session.tableName}</Heading>
        </div>
        {!session.closed && (
          <Button
            variant="secondary"
            aria-label={t("tables.more.label")}
            aria-expanded={open}
            aria-controls={open ? cardId : undefined}
            disabled={off}
            onClick={toggleCard}
          >
            {t("tables.more.button")}
            <span aria-hidden="true" className="ml-1.5">
              ▾
            </span>
          </Button>
        )}
      </div>
      {open && !session.closed && (
        <Card
          id={cardId}
          role="group"
          aria-label={t("tables.panel.editCovers")}
          className="flex flex-col gap-3"
        >
          <p className="text-base font-bold">{t("tables.panel.editCovers")}</p>
          <CoversField value={covers} disabled={busy} onChange={setCovers} />
          <ErrorAlert message={coversError} />
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void saveCovers()} disabled={busy}>
              {t("tables.panel.saveCovers")}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={toggleCard}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={statusTone(session.status)}>{statusWord(session.status)}</Badge>
        {!session.closed && (
          <Button
            variant="secondary"
            aria-pressed={session.billRequested}
            data-on={session.billRequested}
            disabled={off}
            onClick={() => void toggleBill()}
          >
            {session.billRequested && (
              <span aria-hidden="true" className="mr-1.5">
                ✓
              </span>
            )}
            {t("tables.panel.bill")}
          </Button>
        )}
      </div>
      {!session.closed && offline && (
        <p className="text-sm text-ink-muted">{t("tables.panel.needsConnection")}</p>
      )}
      <ErrorAlert message={billError} />
      <p className="num text-sm text-ink-muted">{coversLine(session.covers)}</p>
    </>
  );
}
