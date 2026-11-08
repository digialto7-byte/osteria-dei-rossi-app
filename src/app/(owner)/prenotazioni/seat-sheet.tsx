"use client";

import { useState } from "react";
import { Button, Card, ErrorAlert, Field, Muted, Select } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t } from "@/lib/i18n";
import { rowTitle, type RowView } from "@/lib/reservations/day-view";
import { CoversField, readCovers } from "@/app/(owner)/tavoli/covers-field";

/**
 * "Apri tavolo" on a booking: the covers start at the party size. The session id comes from the page, which keeps one per booking for as long as the page lives, so a second
 * tap after a lost reply, even after the sheet was closed and opened again, is a replay and never a second session. The table is the booking's lead table; a booking with
 * no assigned table asks for one of the tables the server lists for it (free and closed ones; the screen filters nothing).
 */
export function SeatSheet({
  row,
  sessionId,
  seatChoices,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  row: RowView;
  /** The session id of this booking's opening: the same for every attempt. */
  sessionId: string;
  /** The tables to choose from when the booking has no assigned table, as the server lists them; null while they load. */
  seatChoices: { id: string; name: string }[] | null;
  busy: boolean;
  error: string | null;
  onSubmit: (sessionId: string, covers: number, tableId: string | null) => void;
  onCancel: () => void;
}) {
  const heading = useFocusIntoView<HTMLHeadingElement>();
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
          {seatChoices === null ? (
            <Muted>{t("common.loading")}</Muted>
          ) : (
            <Select
              name="seatTable"
              value={tableId}
              disabled={busy}
              onChange={(event) => setTableId(event.target.value)}
            >
              <option value="">{t("reservations.seat.choose")}</option>
              {seatChoices.map((table) => (
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
