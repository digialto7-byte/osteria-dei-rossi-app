"use client";

import { useState } from "react";
import { Button, Card, ErrorAlert, Field, Muted, Select } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t } from "@/lib/i18n";
import { rowTitle, type RowView } from "@/lib/reservations/day-view";
import { newSessionId } from "@/lib/tables/session-id";
import { CoversField, readCovers } from "@/app/(owner)/tavoli/covers-field";

/**
 * "Apri tavolo" on a booking: the covers start at the party size. The session id is made once when the sheet appears and kept for every retry, so a second tap after a lost
 * reply is a replay, never a second session. The table is the booking's lead table; a booking with no assigned table asks for one from the free tables of the room.
 */
export function SeatSheet({
  row,
  freeTables,
  busy,
  error,
  onSubmit,
  onCancel,
  generateId = newSessionId,
}: {
  row: RowView;
  /** The free tables to choose from when the booking has no assigned table; null while they load. */
  freeTables: { id: string; name: string }[] | null;
  busy: boolean;
  error: string | null;
  onSubmit: (sessionId: string, covers: number, tableId: string | null) => void;
  onCancel: () => void;
  generateId?: () => string;
}) {
  const heading = useFocusIntoView<HTMLHeadingElement>();
  const [sessionId] = useState(generateId);
  const [covers, setCovers] = useState(String(row.party));
  const [tableId, setTableId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const needsTable = row.leadTable === null;

  function submit() {
    const read = readCovers(covers);
    if (read === null) return setLocalError(t("tableError.covers_invalid"));
    if (needsTable && tableId === "") return setLocalError(t("reservationError.table_required"));
    setLocalError(null);
    onSubmit(sessionId, read, needsTable ? tableId : null);
  }

  return (
    <Card role="group" aria-label={t("reservations.seat.title")} className="flex flex-col gap-3">
      <h2
        ref={heading}
        tabIndex={-1}
        className="font-display text-[1.5rem] leading-tight font-semibold [overflow-wrap:anywhere]"
      >
        {t("reservations.seat.title")}
      </h2>
      <p className="[overflow-wrap:anywhere]">{rowTitle(row)}</p>
      {row.leadTable && <p>{row.leadTable.name}</p>}
      {needsTable && (
        <Field label={t("reservations.seat.table")}>
          {freeTables === null ? (
            <Muted>{t("common.loading")}</Muted>
          ) : (
            <Select
              name="seatTable"
              value={tableId}
              disabled={busy}
              onChange={(event) => setTableId(event.target.value)}
            >
              <option value="">{t("reservations.seat.choose")}</option>
              {freeTables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <CoversField value={covers} disabled={busy} onChange={setCovers} />
      <div aria-live="polite">
        <ErrorAlert message={localError ?? error} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={busy}>
          {t("reservations.action.seat")}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
      </div>
    </Card>
  );
}
