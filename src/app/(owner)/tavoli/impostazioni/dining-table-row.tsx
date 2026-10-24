"use client";

import { useState } from "react";
import { Badge, Button, Card, Checkbox, ErrorAlert, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { TABLE_NAME_MAX, TABLE_POSITION_MAX } from "@/server/tables/constants";
import type { DiningTable } from "@/server/tables/output";

export interface DiningTablePatch {
  name?: string;
  position?: number;
  active?: boolean;
}

/**
 * One table in the settings: its name, its order, whether a session is open, the "Attivo" switch (sent at once) and
 * "Rinomina", which opens the name and order fields. It sends only what changed; whether a table may be switched off
 * (an open one may not) is the server's answer, shown here as the row's own error.
 */
export function DiningTableRow({
  table,
  busy,
  error,
  onSave,
}: {
  table: DiningTable;
  busy: boolean;
  error: string | null;
  onSave: (patch: DiningTablePatch) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(table.name);
  const [position, setPosition] = useState(String(table.position));
  const [localError, setLocalError] = useState<string | null>(null);

  function save() {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > TABLE_NAME_MAX) {
      return setLocalError(t("tableError.name_invalid"));
    }
    if (!/^\d{1,4}$/.test(position.trim()) || Number(position) > TABLE_POSITION_MAX) {
      return setLocalError(t("tables.error.position"));
    }
    setLocalError(null);
    const patch: DiningTablePatch = {};
    if (trimmed !== table.name) patch.name = trimmed;
    if (Number(position) !== table.position) patch.position = Number(position);
    setEditing(false);
    if (Object.keys(patch).length > 0) onSave(patch);
  }

  return (
    <Card role="group" aria-label={table.name} className="flex flex-col gap-3">
      {editing ? (
        <>
          <Field label={t("common.name")}>
            <TextInput
              name={`name-${table.id}`}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("tables.field.position")}>
            <TextInput
              name={`position-${table.id}`}
              type="text"
              inputMode="numeric"
              value={position}
              disabled={busy}
              onChange={(event) => setPosition(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button onClick={save} disabled={busy}>
              {t("common.save")}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setName(table.name);
                setPosition(String(table.position));
                setLocalError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-lg font-bold [overflow-wrap:anywhere]">{table.name}</p>
          <p className="num text-sm text-ink-muted">{table.position}</p>
          {table.open && <Badge tone="success">{t("tables.status.open")}</Badge>}
          <Button variant="secondary" onClick={() => setEditing(true)} className="self-start">
            {t("tables.rename")}
          </Button>
        </div>
      )}
      <Checkbox
        label={t("tables.active")}
        checked={table.active}
        disabled={busy}
        onChange={(event) => onSave({ active: event.target.checked })}
      />
      <ErrorAlert message={localError ?? error} />
    </Card>
  );
}
