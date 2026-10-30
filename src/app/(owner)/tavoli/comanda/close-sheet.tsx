"use client";

import { useId } from "react";
import { Button, ErrorAlert, Field, TextInput, warningNoteClass } from "@/components/ui";
import { paymentTypeLabel, receiptTypeLabel } from "@/lib/bill/bill-view";
import {
  canSubmitClose,
  closeBlockText,
  closeButtonLabel,
  type CloseBlock,
  type CloseForm,
} from "@/lib/bill/close-form";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { PAYMENT_TYPES, RECEIPT_TYPES } from "@/server/bill/constants";

/** A radio group with no option chosen at the start: the waiter has to say what was printed and how the guest paid. */
function Choice<T extends string>({
  legend,
  name,
  options,
  value,
  label,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: T | null;
  label: (option: T) => string;
  onChange: (option: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-[0.9375rem] font-bold text-ink">
        {legend}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option}
            className="flex min-h-tap cursor-pointer items-center gap-2 rounded-lg border border-rule-strong bg-surface px-3 has-[:checked]:border-accent has-[:checked]:bg-sunk"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="size-5 accent-accent"
            />
            <span>{label(option)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * "Chiudi tavolo" (M21 plan §3.6): the total, the document the register printed, its number (optional: without one the table is closed
 * and flagged in the cash close), and how the guest paid. The button waits for a document and a payment, and while the phone is
 * offline or still holds orders of this table in its queue (the page works out `block`). All logic is in close-form.ts.
 */
export function CloseSheet({
  total,
  form,
  onForm,
  block,
  queuedCount,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  total: number;
  form: CloseForm;
  onForm: (form: CloseForm) => void;
  block: CloseBlock;
  queuedCount: number;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const noNumber = form.receiptNumber.trim() === "";
  const blockText = closeBlockText(block, queuedCount);
  return (
    <section className="flex flex-col gap-4 rounded-card border border-rule bg-surface p-4">
      <h3 className="font-display text-xl font-semibold">{t("bill.close.open")}</h3>
      <p className="text-xl font-bold tabular-nums">
        {t("bill.close.total", { amount: formatEuro(total) })}
      </p>
      <Choice
        legend={t("bill.close.document")}
        name="receipt-type"
        options={RECEIPT_TYPES}
        value={form.receiptType}
        label={(option) => receiptTypeLabel(option)}
        onChange={(receiptType) => onForm({ ...form, receiptType })}
      />
      <Field label={t("bill.close.number")} hint={t("bill.close.numberHint")}>
        <TextInput
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={20}
          value={form.receiptNumber}
          onChange={(event) => onForm({ ...form, receiptNumber: event.target.value })}
        />
      </Field>
      <Choice
        legend={t("bill.close.payment")}
        name="payment-type"
        options={PAYMENT_TYPES}
        value={form.paymentType}
        label={(option) => paymentTypeLabel(option)}
        onChange={(paymentType) => onForm({ ...form, paymentType })}
      />
      {noNumber && (
        <p role="status" className={warningNoteClass}>
          {t("bill.close.flagWarning")}
        </p>
      )}
      <ErrorAlert message={error} />
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy || !canSubmitClose(form, block)} onClick={onSubmit}>
          {closeButtonLabel(form)}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t("bill.close.cancel")}
        </Button>
      </div>
      {blockText && (
        <p role="status" className="text-ink-muted">
          {blockText}
        </p>
      )}
    </section>
  );
}
