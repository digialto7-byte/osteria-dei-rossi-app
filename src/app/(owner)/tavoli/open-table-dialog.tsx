"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, ErrorAlert, SubHeading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { newSessionId } from "@/lib/tables/session-id";
import { CoversField, readCovers } from "./covers-field";

const START_COVERS = "2";

/**
 * The opening of a free (or closed) table, as a bottom sheet in thumb reach (docs/ux/p3-sala-waiter.md §10.1): the covers, "Apri tavolo"
 * and a quiet "Annulla". A modal dialog: focus goes to its heading on open and Tab stays inside; Esc, a tap on the scrim and "Annulla"
 * call `onCancel` (the page puts focus back on the tile), except while the opening is in flight. The session id is made once when the
 * sheet appears and kept for every retry, so a second tap after a lost reply is a replay, never a second session.
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
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return busy ? undefined : onCancel();
      if (event.key !== "Tab" || !dialog.current) return;
      // Tab cycles through the sheet's enabled controls; from the page behind it is pulled back in.
      const controls = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        ),
      ];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        // While the opening is in flight every control is off: Tab has nowhere to go inside the sheet, so it stays on the heading.
        event.preventDefault();
        heading.current?.focus();
        return;
      }
      const active = document.activeElement;
      if (!dialog.current.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === heading.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel, heading]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const read = readCovers(covers);
    if (read === null) return setLocalError(t("tableError.covers_invalid"));
    setLocalError(null);
    onSubmit(sessionId, read);
  }

  return (
    <>
      <div
        aria-hidden="true"
        data-slot="sheet-scrim"
        className="fixed inset-0 z-40 bg-ink/40"
        onClick={busy ? undefined : onCancel}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Above the phone tab bar (z-30, later in the DOM): an owner or admin on a phone has the bar, and it must never cover "Apri tavolo".
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-rule-strong bg-surface p-4 shadow-lg"
      >
        <form method="post" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <SubHeading
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className="outline-none [overflow-wrap:anywhere]"
          >
            {t("tables.open.title", { name: table.name })}
          </SubHeading>
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
      </div>
    </>
  );
}
