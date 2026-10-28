"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { newSessionId } from "@/lib/tables/session-id";
import { CoversField, readCovers } from "./covers-field";

const START_COVERS = "2";

/**
 * The opening of a free (or closed) table: the covers and "Apri tavolo". The session id is made once when the
 * dialog appears and kept for every retry, so a second tap after a lost reply is a replay, never a second session.
 */
export function OpenTableDialog({
  table,
  busy,
  error,
  onSubmit,
  onCancel,
  generateId = newSessionId,
}: {
  table: { id: string; name: string };
  busy: boolean;
  error: string | null;
  onSubmit: (sessionId: string, covers: number) => void;
  onCancel: () => void;
  generateId?: () => string;
}) {
  const [sessionId] = useState(generateId);
  const [covers, setCovers] = useState(START_COVERS);
  const [localError, setLocalError] = useState<string | null>(null);
  const heading = useFocusIntoView<HTMLHeadingElement>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const read = readCovers(covers);
    if (read === null) return setLocalError(t("tableError.covers_invalid"));
    setLocalError(null);
    onSubmit(sessionId, read);
  }

  return (
    <Card role="group" aria-label={t("tables.open.title", { name: table.name })}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <h2
          ref={heading}
          tabIndex={-1}
          className="font-display text-[1.5rem] leading-tight font-semibold [overflow-wrap:anywhere]"
        >
          {t("tables.open.title", { name: table.name })}
        </h2>
        <CoversField value={covers} disabled={busy} onChange={setCovers} />
        <ErrorAlert message={localError ?? error} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            {t("tables.open.submit")}
          </Button>
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
