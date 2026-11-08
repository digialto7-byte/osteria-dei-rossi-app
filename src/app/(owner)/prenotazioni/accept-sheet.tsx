"use client";

import { useState } from "react";
import { Button, Card, Checkbox, ErrorAlert, Muted } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t, tn } from "@/lib/i18n";
import { optionLabel, pickOf, rowTitle, type RowView } from "@/lib/reservations/day-view";
import type { Suggestion, TableBooking } from "@/server/reservations/output";
import type { TablePickBody } from "@/server/reservations/schemas";

type Choice = "suggested" | `alt:${number}` | "choose" | "none";

function Radio({
  checked,
  label,
  disabled,
  onSelect,
}: {
  checked: boolean;
  label: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex min-h-tap cursor-pointer items-center gap-3 [overflow-wrap:anywhere]">
      <input
        type="radio"
        name="tablePick"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="size-5 shrink-0 accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * "Accetta" (and "Cambia tavoli"): the database's suggestion is preselected, its alternatives follow, then "Scegli tavoli" (every table of the room) and "Senza tavolo".
 * The sheet sends what was chosen as { tableIds, groupId }; "Senza tavolo" is both null. Whether a table is free is the server's answer (409 table_taken).
 */
export function AcceptSheet({
  mode,
  row,
  suggestion,
  booking,
  loading,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  mode: "accept" | "tables";
  row: RowView;
  suggestion: Suggestion | null;
  booking: TableBooking | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (body: TablePickBody) => void;
  onCancel: () => void;
}) {
  const heading = useFocusIntoView<HTMLHeadingElement>();
  const suggested = suggestion?.suggested ?? null;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  // Until the person picks, the suggestion is the choice (or "Senza tavolo" when there is none).
  const current: Choice = choice ?? (suggested ? "suggested" : "none");

  function submit() {
    if (current === "suggested" && suggested) return onSubmit(pickOf(suggested));
    if (current.startsWith("alt:")) {
      const option = suggestion?.alternatives[Number(current.slice(4))];
      if (option) return onSubmit(pickOf(option));
    }
    if (current === "choose") {
      if (picked.length === 0) return setLocalError(t("reservations.accept.pickOne"));
      setLocalError(null);
      return onSubmit({ tableIds: picked, groupId: null });
    }
    onSubmit({ tableIds: null, groupId: null });
  }

  const title = t(mode === "accept" ? "reservations.accept.title" : "reservations.tables.title");
  return (
    <Card role="group" aria-label={title} className="flex flex-col gap-3">
      <h2
        ref={heading}
        tabIndex={-1}
        className="font-display text-[1.5rem] leading-tight font-semibold [overflow-wrap:anywhere]"
      >
        {title}
      </h2>
      <p className="[overflow-wrap:anywhere]">{rowTitle(row)}</p>
      {loading ? (
        <Muted>{t("common.loading")}</Muted>
      ) : (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">{t("reservations.accept.legend")}</legend>
          {suggested ? (
            <Radio
              checked={current === "suggested"}
              disabled={busy}
              label={t("reservations.accept.suggested", { option: optionLabel(suggested) })}
              onSelect={() => setChoice("suggested")}
            />
          ) : (
            <Muted>{t("reservations.accept.noSuggestion")}</Muted>
          )}
          {(suggestion?.alternatives ?? []).map((option, index) => (
            <Radio
              key={`${option.groupId ?? ""}:${option.tableIds.join(",")}`}
              checked={current === `alt:${index}`}
              disabled={busy}
              label={optionLabel(option)}
              onSelect={() => setChoice(`alt:${index}`)}
            />
          ))}
          <Radio
            checked={current === "choose"}
            disabled={busy}
            label={t("reservations.accept.choose")}
            onSelect={() => setChoice("choose")}
          />
          {current === "choose" && (
            <div className="flex flex-col gap-1 pl-8">
              {(booking?.tables ?? []).map((table) => (
                <Checkbox
                  key={table.tableId}
                  name={`pick-${table.tableId}`}
                  label={
                    table.seats === null
                      ? table.name
                      : `${table.name}, ${tn("reservations.seats", table.seats)}`
                  }
                  checked={picked.includes(table.tableId)}
                  disabled={busy}
                  onChange={(event) =>
                    setPicked((list) =>
                      event.target.checked
                        ? [...list, table.tableId]
                        : list.filter((id) => id !== table.tableId),
                    )
                  }
                />
              ))}
            </div>
          )}
          <Radio
            checked={current === "none"}
            disabled={busy}
            label={t("reservations.accept.none")}
            onSelect={() => setChoice("none")}
          />
        </fieldset>
      )}
      <div aria-live="polite">
        <ErrorAlert message={localError ?? error} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={busy || loading}>
          {t("reservations.accept.submit")}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
      </div>
    </Card>
  );
}
