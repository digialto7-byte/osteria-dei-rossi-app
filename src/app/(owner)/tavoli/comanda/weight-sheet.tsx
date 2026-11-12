"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { formatCount } from "@/lib/format/count";
import { formatWeight } from "@/lib/format/weight";
import { t } from "@/lib/i18n";
import { parseWeightText, weightAllowed, weightNeedsConfirm } from "@/lib/orders/line-form";
import { WEIGHT_MIN_G, WEIGHT_STEP_G } from "@/server/orders/constants";

/**
 * The weight sheet of a dish sold by weight (P2-0b): one numeric field in grams ("Peso (g)", focused first), a live
 * "= 1,2 kg" readout, and "Aggiungi" (or "Salva" when editing a draft line) that stays disabled until the weight is
 * at least 50 g, on the 10 g step and within the menu's maximum. From 3 times the dish's reference portion it asks
 * "Confermi 1.200 g?" first. The limits are the menu's (`weightMaxG`), the readout is formatting only; the price of the
 * line is the database's, never worked out here.
 */
export function WeightSheet({
  name,
  weightMaxG,
  portionWeightG,
  initialWeightG,
  mode,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string;
  weightMaxG: number;
  /** The dish's reference portion in grams, when the menu says it; without it there is no confirmation. */
  portionWeightG: number | null;
  initialWeightG: number | null;
  mode: "add" | "edit";
  busy: boolean;
  onConfirm: (weightG: number) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialWeightG === null ? "" : String(initialWeightG));
  const [confirming, setConfirming] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);

  const grams = parseWeightText(text);
  const allowed = grams !== null && weightAllowed(grams, weightMaxG);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || grams === null || !allowed) return;
    if (!confirming && weightNeedsConfirm(grams, portionWeightG)) return setConfirming(true);
    onConfirm(grams);
  }

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-20 bg-ink/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("orders.weight.title", { name })}
        className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-3 rounded-t-2xl border-t border-rule-strong bg-surface p-4 shadow-lg"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <p className="font-bold [overflow-wrap:anywhere]">{name}</p>
          <Field
            label={t("orders.weight.field")}
            hint={t("orders.weight.range", {
              min: formatCount(WEIGHT_MIN_G),
              max: formatCount(weightMaxG),
              step: formatCount(WEIGHT_STEP_G),
            })}
          >
            <TextInput
              ref={field}
              name="weightG"
              type="text"
              inputMode="numeric"
              step={WEIGHT_STEP_G}
              value={text}
              disabled={busy || confirming}
              aria-invalid={text !== "" && !allowed ? true : undefined}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <p
            data-testid="weight-readout"
            aria-live="polite"
            className="num min-h-6 text-lg font-bold"
          >
            {grams !== null && t("orders.weight.readout", { weight: formatWeight(grams) })}
          </p>
          {confirming && grams !== null ? (
            <div className="flex flex-col gap-3">
              <p role="alert" className="text-lg font-bold text-warning">
                {t("orders.weight.confirm", { weight: `${formatCount(grams)} g` })}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={busy}>
                  {t("orders.weight.confirmYes")}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  {t("orders.weight.change")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy || !allowed}>
                {t(mode === "add" ? "orders.weight.add" : "orders.weight.save")}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={onCancel}>
                {t("common.cancel")}
              </Button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
