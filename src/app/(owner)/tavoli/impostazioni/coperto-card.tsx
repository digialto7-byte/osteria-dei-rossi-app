"use client";

import { useState } from "react";
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  Muted,
  Select,
  SubHeading,
  TextInput,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { copertoBodyFromForm, copertoFormFromRead } from "@/lib/tables/coperto-form";
import type { CopertoBody } from "@/server/tables/schemas";

/**
 * The coperto per person and its VAT rate. An empty amount means no coperto. The rate is pre-filled from the coperto
 * itself, or from the server's default when none is set. Saving applies to tables opened from now on.
 */
export function CopertoCard({
  coperto,
  defaultVatRate,
  vatRates,
  busy,
  error,
  onSave,
}: {
  coperto: { amount: number; vatRate: number } | null;
  defaultVatRate: number | null;
  vatRates: readonly number[];
  busy: boolean;
  error: string | null;
  onSave: (body: CopertoBody) => void;
}) {
  const [form, setForm] = useState(() => copertoFormFromRead(coperto, defaultVatRate));
  const [localError, setLocalError] = useState<string | null>(null);

  function save() {
    const built = copertoBodyFromForm(form);
    if (!built.ok) return setLocalError(built.error);
    setLocalError(null);
    onSave(built.body);
  }

  return (
    <Card role="group" aria-label={t("tables.coperto.title")} className="flex flex-col gap-3">
      <SubHeading>{t("tables.coperto.title")}</SubHeading>
      <Field label={t("tables.coperto.amount")} hint={t("tables.coperto.amountHint")}>
        <TextInput
          name="copertoAmount"
          type="text"
          inputMode="decimal"
          value={form.amount}
          disabled={busy}
          onChange={(event) => setForm({ ...form, amount: event.target.value })}
        />
      </Field>
      <Field label={t("tables.coperto.vatRate")}>
        <Select
          name="copertoVatRate"
          value={form.vatRate}
          disabled={busy}
          onChange={(event) => setForm({ ...form, vatRate: event.target.value })}
        >
          {form.vatRate === "" && <option value="">{t("tables.coperto.vatRate.choose")}</option>}
          {vatRates.map((rate) => (
            <option key={rate} value={String(rate)}>
              {t("menu.form.vatRate.option", { rate })}
            </option>
          ))}
        </Select>
      </Field>
      <Muted>{t("tables.coperto.note")}</Muted>
      <ErrorAlert message={localError ?? error} />
      <Button onClick={save} disabled={busy} className="self-start">
        {t("common.save")}
      </Button>
    </Card>
  );
}
