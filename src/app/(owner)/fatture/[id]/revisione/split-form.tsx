"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { splitRemainder } from "@/lib/invoices/split-remainder";
import { formatEuro } from "@/lib/money/format";
import { parseDecimal } from "@/lib/numbers/parse-decimal";
import { formatNumber, formatQty } from "@/lib/units";
import type { ReviewLine } from "@/server/invoices/review-types";
import type { LineActions } from "./actions";

const MIN_PARTS = 2;
const MAX_PARTS = 10;

interface Part {
  qty: string;
  amount: string;
}

const read = (text: string) => {
  const result = parseDecimal(text);
  return result.ok ? result.value : null;
};

/**
 * Divides a line into 2 to 10 parts. The screen shows what is left to assign; the exact-sum rule
 * is the API's (and the database's), whose message appears here when the parts do not add up.
 */
export function SplitForm({
  line,
  actions,
  onClose,
}: {
  line: ReviewLine;
  actions: Pick<LineActions, "split">;
  onClose: () => void;
}) {
  const [parts, setParts] = useState<Part[]>(() =>
    Array.from({ length: MIN_PARTS }, () => ({ qty: "", amount: "" })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const left = splitRemainder(
    line,
    parts.map((part) => ({ qty: read(part.qty), lineAmount: read(part.amount) })),
  );
  const change = (index: number, patch: Partial<Part>) =>
    setParts((current) => current.map((part, i) => (i === index ? { ...part, ...patch } : part)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const children = parts.map((part) => ({ qty: read(part.qty), lineAmount: read(part.amount) }));
    if (children.some((child) => child.qty === null || child.lineAmount === null)) {
      setError(t("review.error.number", { field: t("review.splitTitle") }));
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await actions.split(line.id, children as { qty: number; lineAmount: number }[]);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <form
      onSubmit={submit}
      aria-label={t("review.splitTitle")}
      className="flex w-full flex-col gap-4 rounded-lg border border-rule p-3"
    >
      <p className="font-bold">{t("review.splitTitle")}</p>
      {parts.map((part, index) => (
        <div key={index} className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("review.partQty", { n: index + 1 })}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={part.qty}
                onChange={(event) => change(index, { qty: event.target.value })}
              />
            </Field>
            <Field label={t("review.partAmount", { n: index + 1 })}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={part.amount}
                onChange={(event) => change(index, { amount: event.target.value })}
              />
            </Field>
          </div>
          {parts.length > MIN_PARTS && (
            <Button
              variant="quiet"
              className="self-start"
              onClick={() => setParts((current) => current.filter((_, i) => i !== index))}
            >
              {t("review.removePart", { n: index + 1 })}
            </Button>
          )}
        </div>
      ))}
      <p className="num text-sm text-ink-muted" data-testid="split-remaining">
        {t("review.remaining", {
          qty: line.unit ? formatQty(left.qty, line.unit) : formatNumber(left.qty),
          amount: formatEuro(left.lineAmount),
        })}
      </p>
      <ErrorAlert message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {t("review.splitConfirm")}
        </Button>
        <Button
          variant="secondary"
          disabled={parts.length >= MAX_PARTS}
          onClick={() => setParts((current) => [...current, { qty: "", amount: "" }])}
        >
          {t("review.addPart")}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
