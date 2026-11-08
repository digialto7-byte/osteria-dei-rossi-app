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
import { t, tn, type MessageKey } from "@/lib/i18n";
import { newGroupBody } from "@/lib/reservations/settings-view";
import type { TableBooking } from "@/server/reservations/output";
import type { TableGroupBody } from "@/server/reservations/schemas";

/** The key of the error and the busy state of the "Nuovo gruppo" form. */
export const NEW_GROUP_KEY = "new-group";

/**
 * "Gruppi di tavoli": the active groups (a group has its own seats, not the sum of its tables) and "Nuovo gruppo". The members of a group never change: to edit one,
 * deactivate it and create a new one. Errors come from the page keyed by the group id, or "new" for the form.
 */
export function TableGroupsCard({
  booking,
  busyKey,
  errors,
  onCreate,
  onDeactivate,
}: {
  booking: TableBooking;
  busyKey: string | null;
  errors: Record<string, string>;
  onCreate: (body: TableGroupBody) => void;
  onDeactivate: (groupId: string) => void;
}) {
  const [name, setName] = useState("");
  const [seats, setSeats] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = busyKey !== null;
  const tableName = (id: string) => booking.tables.find((x) => x.tableId === id)?.name ?? "";

  function create() {
    const result = newGroupBody(name, seats, picked);
    if (!result.ok)
      return setLocalError(t(`reservationError.group.${result.reason}` as MessageKey));
    setLocalError(null);
    onCreate(result.body);
  }

  return (
    <Card role="group" aria-label={t("tableGroups.title")} className="flex flex-col gap-3">
      <SubHeading>{t("tableGroups.title")}</SubHeading>
      <Muted>{t("tableGroups.hint")}</Muted>
      {booking.groups.length === 0 ? (
        <Muted>{t("tableGroups.none")}</Muted>
      ) : (
        <ul className="flex flex-col gap-3">
          {booking.groups.map((group) => (
            <li key={group.id} className="flex flex-col gap-2 border-t border-rule pt-3">
              <p className="[overflow-wrap:anywhere]">
                {t("tableGroups.item", {
                  name: group.name,
                  seats: tn("tableGroups.seats", group.seats),
                  tables: group.tableIds.map(tableName).join(", "),
                })}
              </p>
              <Button
                variant="secondary"
                aria-label={t("tableGroups.deactivateAria", { name: group.name })}
                disabled={busy}
                onClick={() => onDeactivate(group.id)}
                className="self-start"
              >
                {t("tableGroups.deactivate")}
              </Button>
              <div aria-live="polite">
                <ErrorAlert message={errors[group.id] ?? null} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 border-t border-rule pt-3">
        <p className="font-bold">{t("tableGroups.new")}</p>
        <Field label={t("tableGroups.name")}>
          <TextInput
            name="groupName"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t("tableGroups.seatsField")}>
          <TextInput
            name="groupSeats"
            type="text"
            inputMode="numeric"
            value={seats}
            disabled={busy}
            onChange={(event) => setSeats(event.target.value)}
          />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-bold">{t("tableGroups.tables")}</legend>
          {booking.tables.map((table) => (
            <Checkbox
              key={table.tableId}
              name={`groupTable-${table.tableId}`}
              label={table.name}
              checked={picked.includes(table.tableId)}
              disabled={busy}
              onChange={(event) =>
                setPicked((current) =>
                  event.target.checked
                    ? [...current, table.tableId]
                    : current.filter((id) => id !== table.tableId),
                )
              }
            />
          ))}
        </fieldset>
        <div aria-live="polite">
          <ErrorAlert message={localError ?? errors[NEW_GROUP_KEY] ?? null} />
        </div>
        <Button onClick={create} disabled={busy} className="self-start">
          {t("tableGroups.create")}
        </Button>
      </div>
    </Card>
  );
}
