import type { FormEvent } from "react";
import {
  Button,
  Card,
  Field,
  LedgerList,
  LedgerRow,
  SubHeading,
  SuccessNote,
  TextInput,
} from "@/components/ui";
import { monthLabel } from "@/lib/costing/cost-view";
import type { FieldErrors, FixedCostFormState } from "@/lib/costing/cost-forms";
import { t } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import type { FixedCostPeriod } from "@/server/costing/types";

const FieldError = ({ message }: { message?: string }) =>
  message ? (
    <span role="alert" className="text-sm text-danger">
      {message}
    </span>
  ) : null;

/**
 * The owner's form for the monthly fixed costs (rent, staff, utilities; totals only, never per
 * person) and the months already entered. The owner only: the page does not render it otherwise.
 */
export function FixedCostForm({
  state,
  errors,
  periods,
  busy,
  saved,
  onChange,
  onSubmit,
}: {
  state: FixedCostFormState;
  errors: FieldErrors;
  periods: FixedCostPeriod[];
  busy: boolean;
  saved: boolean;
  onChange: (next: FixedCostFormState) => void;
  onSubmit: () => void;
}) {
  const set = (field: keyof FixedCostFormState) => (value: string) =>
    onChange({ ...state, [field]: value });
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <SubHeading>{t("costs.fixedForm.title")}</SubHeading>
        <Field label={t("costs.fixedForm.month")}>
          <TextInput
            type="month"
            name="month"
            value={state.month}
            onChange={(e) => set("month")(e.target.value)}
          />
        </Field>
        <FieldError message={errors.month} />
        {(
          [
            ["rent", "rentEur", "costs.fixedForm.rent"],
            ["labour", "labourEur", "costs.fixedForm.labour"],
            ["utilities", "utilitiesEur", "costs.fixedForm.utilities"],
          ] as const
        ).map(([field, apiField, label]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Field label={t(label)}>
              <TextInput
                type="text"
                inputMode="decimal"
                name={field}
                autoComplete="off"
                value={state[field]}
                onChange={(e) => set(field)(e.target.value)}
              />
            </Field>
            <FieldError message={errors[apiField]} />
          </div>
        ))}
        <p className="text-sm leading-snug text-ink-muted">{t("costs.fixedForm.hint")}</p>
        <div>
          <Button type="submit" disabled={busy}>
            {t("costs.fixedForm.submit")}
          </Button>
        </div>
        {saved && <SuccessNote role="status">{t("costs.fixedForm.saved")}</SuccessNote>}
      </form>
      {periods.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="font-bold">{t("costs.fixedForm.months")}</h3>
          <LedgerList>
            {periods.map((period) => (
              <LedgerRow key={period.id} className="num py-2">
                {monthLabel(period.month)} · {formatEuro(period.totalEur)}
                {period.superseded && (
                  <span className="text-ink-muted"> · {t("costs.fixedForm.superseded")}</span>
                )}
              </LedgerRow>
            ))}
          </LedgerList>
        </div>
      )}
    </Card>
  );
}
