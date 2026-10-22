"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { buildHeaderPatch, initialHeaderForm, type HeaderForm } from "@/lib/invoices/header-form";
import type { InvoiceReview } from "@/server/invoices/review-types";
import type { Outcome } from "./actions";

const numberInput = { inputMode: "decimal" as const, autoComplete: "off" };

/** "Correggi intestazione": number, dates and totals. The totals gate and duplicate check are re-run by the API. */
export function HeaderEditor({
  invoice,
  save,
}: {
  invoice: InvoiceReview["invoice"];
  save: (patch: Record<string, unknown>) => Outcome;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HeaderForm>(() => initialHeaderForm(invoice));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof HeaderForm, value: string) => setForm((c) => ({ ...c, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const built = buildHeaderPatch(invoice, form);
    if (!built.ok) return setError(built.message);
    if (Object.keys(built.patch).length === 0) return setOpen(false);
    setBusy(true);
    setError(null);
    const failure = await save(built.patch);
    setBusy(false);
    if (failure) setError(failure);
    else setOpen(false);
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        aria-expanded="false"
        className="self-start"
        onClick={() => {
          setForm(initialHeaderForm(invoice));
          setOpen(true);
        }}
      >
        {t("review.header.edit")}
      </Button>
    );
  }
  return (
    <form
      onSubmit={submit}
      aria-label={t("review.header.edit")}
      className="flex w-full flex-col gap-4 rounded-lg border border-rule p-3"
    >
      <Field label={t("invoices.number")}>
        <TextInput
          value={form.numberRaw}
          maxLength={64}
          onChange={(e) => set("numberRaw", e.target.value)}
        />
      </Field>
      <Field label={t("invoices.invoiceDate")}>
        <TextInput
          type="date"
          value={form.invoiceDate}
          onChange={(e) => set("invoiceDate", e.target.value)}
        />
      </Field>
      <Field label={t("invoices.dueDate")}>
        <TextInput
          type="date"
          value={form.dueDate}
          onChange={(e) => set("dueDate", e.target.value)}
        />
      </Field>
      <Field label={t("invoices.netTotal")}>
        <TextInput
          {...numberInput}
          value={form.netTotal}
          onChange={(e) => set("netTotal", e.target.value)}
        />
      </Field>
      <Field label={t("invoices.vatTotal")}>
        <TextInput
          {...numberInput}
          value={form.vatTotal}
          onChange={(e) => set("vatTotal", e.target.value)}
        />
      </Field>
      <Field label={t("invoices.grossTotal")}>
        <TextInput
          {...numberInput}
          value={form.grossTotal}
          onChange={(e) => set("grossTotal", e.target.value)}
        />
      </Field>
      <ErrorAlert message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {t("review.header.save")}
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
