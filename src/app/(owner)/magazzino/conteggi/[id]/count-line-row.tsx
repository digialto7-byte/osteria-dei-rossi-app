"use client";

import { Field, LedgerRow, TextInput } from "@/components/ui";
import { differenceText } from "@/lib/counts/count-view";
import { t } from "@/lib/i18n";
import { formatQty } from "@/lib/units/format";
import type { CountLine } from "@/server/counts/types";

export type LineState = "idle" | "saving" | "saved" | "error";

/**
 * One ingredient of an open count, 56 px high (kitchen size): the name in bold, what the app expects, and ONE input
 * for what was counted, with the unit as a suffix. Leaving the input saves the line; Enter moves to the next one
 * (the page does both). The expected figure and the difference are the server's: "Atteso" is the snapshot once the
 * line is entered, else the quantity now. Nothing here is added up or compared, and no money appears.
 */
export function CountLineRow({
  line,
  text,
  state,
  onText,
  onLeave,
  onEnter,
}: {
  line: CountLine;
  text: string;
  state: LineState;
  onText: (value: string) => void;
  onLeave: () => void;
  onEnter: () => void;
}) {
  const expected = line.expectedQty ?? line.expectedNowQty;
  return (
    <LedgerRow className="flex min-h-14 flex-col gap-1.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 font-bold [overflow-wrap:anywhere]">{line.name}</span>
        <p className="num shrink-0 text-ink-muted">
          {t("count.line.expected", { qty: formatQty(expected, line.baseUnit) })}
        </p>
      </div>
      <Field label={t("count.line.input", { unit: line.baseUnit })}>
        <span className="flex items-center gap-2">
          <TextInput
            name={`qty-${line.ingredientId}`}
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            value={text}
            onChange={(event) => onText(event.target.value)}
            onBlur={onLeave}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onEnter();
              }
            }}
          />
          <span aria-hidden="true" className="text-ink-muted">
            {line.baseUnit}
          </span>
        </span>
      </Field>
      <p className="num text-sm" aria-live="polite">
        {state === "saving" && t("count.line.saving")}
        {state === "error" && <span className="text-danger">{t("count.line.error")}</span>}
        {state === "saved" && t("count.line.saved")}
        {line.differenceQty !== null && state !== "error" && (
          <>
            {state === "saved" ? " · " : ""}
            {differenceText(line.differenceQty, line.baseUnit)}
          </>
        )}
      </p>
    </LedgerRow>
  );
}
