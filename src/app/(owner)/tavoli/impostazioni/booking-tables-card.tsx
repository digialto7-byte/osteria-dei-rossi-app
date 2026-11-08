"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Muted,
  SubHeading,
  TextInput,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  draftFromBooking,
  tableBookingChanges,
  type BookingDraftRow,
} from "@/lib/reservations/settings-view";
import type { TableBooking } from "@/server/reservations/output";
import type { TableBookingBody } from "@/server/reservations/schemas";

/**
 * "Tavoli prenotabili": per table, a switch (the table can be given to a booking) and "Posti". Tables that are not switched on are never suggested. It sends only the
 * tables that changed; seats left empty mean "not set", and a table without seats is never proposed.
 */
export function BookingTablesCard({
  booking,
  busy,
  error,
  onSave,
}: {
  booking: TableBooking;
  busy: boolean;
  error: string | null;
  onSave: (body: TableBookingBody) => void;
}) {
  const [rows, setRows] = useState<BookingDraftRow[]>(() => draftFromBooking(booking));
  const [localError, setLocalError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const change = (tableId: string, patch: Partial<BookingDraftRow>) => {
    setRows((current) =>
      current.map((row) => (row.tableId === tableId ? { ...row, ...patch } : row)),
    );
    setNote(null);
  };

  function save() {
    const result = tableBookingChanges(booking, rows);
    if (!result.ok) {
      setNote(null);
      return setLocalError(t("reservationError.booking.seats"));
    }
    setLocalError(null);
    if (result.tables.length === 0) return setNote(t("reservations.unchanged"));
    setNote(null);
    onSave({ tables: result.tables });
  }

  return (
    <Card role="group" aria-label={t("bookingTables.title")} className="flex flex-col gap-3">
      <SubHeading>{t("bookingTables.title")}</SubHeading>
      <Muted>{t("bookingTables.hint")}</Muted>
      {booking.tables.length === 0 ? (
        <Muted>{t("bookingTables.none")}</Muted>
      ) : (
        <ul className="flex flex-col gap-3">
          {booking.tables.map((table) => {
            const row = rows.find((r) => r.tableId === table.tableId);
            if (!row) return null;
            return (
              <li key={table.tableId} className="flex flex-col gap-2 border-t border-rule pt-3">
                <Checkbox
                  name={`bookable-${table.tableId}`}
                  label={t("bookingTables.bookable", { name: table.name })}
                  checked={row.bookable}
                  disabled={busy}
                  onChange={(event) => change(table.tableId, { bookable: event.target.checked })}
                />
                <Field label={t("bookingTables.seats", { name: table.name })}>
                  <TextInput
                    name={`seats-${table.tableId}`}
                    type="text"
                    inputMode="numeric"
                    value={row.seats}
                    disabled={busy}
                    onChange={(event) => change(table.tableId, { seats: event.target.value })}
                  />
                </Field>
              </li>
            );
          })}
        </ul>
      )}
      <div aria-live="polite">
        <ErrorAlert message={localError ?? error} />
        {note && <Muted>{note}</Muted>}
      </div>
      <Button onClick={save} disabled={busy || booking.tables.length === 0} className="self-start">
        {t("bookingTables.save")}
      </Button>
    </Card>
  );
}
