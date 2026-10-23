import type { FormEvent } from "react";
import { Button, Card, Field, SubHeading, SuccessNote, TextInput } from "@/components/ui";
import type { FieldErrors, RulesFormState } from "@/lib/costing/cost-forms";
import { t } from "@/lib/i18n";

/** The three calculation rules: purchases in the average, the price alert threshold and the sale VAT. */
export function CostRulesForm({
  state,
  errors,
  busy,
  saved,
  onChange,
  onSubmit,
}: {
  state: RulesFormState;
  errors: FieldErrors;
  busy: boolean;
  saved: boolean;
  onChange: (next: RulesFormState) => void;
  onSubmit: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  const fields = [
    ["avgCostN", "costs.rules.avgN", undefined],
    ["priceVariancePct", "costs.rules.variance", undefined],
    ["saleVatPct", "costs.rules.vat", "costs.rules.vatHint"],
  ] as const;
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <SubHeading>{t("costs.rules.title")}</SubHeading>
        {fields.map(([field, label, hint]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Field label={t(label)} hint={hint ? t(hint) : undefined}>
              <TextInput
                type="text"
                inputMode="decimal"
                name={field}
                autoComplete="off"
                value={state[field]}
                onChange={(e) => onChange({ ...state, [field]: e.target.value })}
              />
            </Field>
            {errors[field] && (
              <span role="alert" className="text-sm text-danger">
                {errors[field]}
              </span>
            )}
          </div>
        ))}
        <div>
          <Button type="submit" variant="secondary" disabled={busy}>
            {t("costs.rules.submit")}
          </Button>
        </div>
        {saved && <SuccessNote role="status">{t("costs.rules.saved")}</SuccessNote>}
      </form>
    </Card>
  );
}
