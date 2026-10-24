"use client";

import { useId, useState, type FormEvent } from "react";
import { Badge, Button, ErrorAlert, Field, LedgerRow, TextInput } from "@/components/ui";
import { formatCount, parseUsedQty, qtyToInput } from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { confirmedLine, ruleLine } from "@/lib/staff-meals/staff-meal-view";
import type { StaffMealRuleItem } from "@/server/staff-meals/types";

/**
 * One staff-meal rule: "Ragù (demo) · 2 porzioni", what is available, and the one primary action of the row,
 * "Conferma pasto di oggi" (44 px). Once today's meal is confirmed the row says when and by whom instead, with no
 * button. "Cambia quantità" opens today's quantity; "Disattiva" / "Riattiva" switches the rule. Whether today is
 * already confirmed, and what is available, are the API's; nothing is worked out here.
 */
export function RuleRow({
  rule,
  busy,
  error,
  onConfirm,
  onToggle,
  locale = DEFAULT_LOCALE,
  initialChanging = false,
}: {
  rule: StaffMealRuleItem;
  busy: boolean;
  /** The server's Italian message for the last failed action on this rule. */
  error: string | null;
  /** Resolves true when recorded; `count` is set only when the quantity of today was changed. */
  onConfirm: (count?: number) => Promise<boolean>;
  onToggle: (isActive: boolean) => void;
  locale?: Locale;
  initialChanging?: boolean;
}) {
  const nameId = useId();
  const [changing, setChanging] = useState(initialChanging);
  const [count, setCount] = useState(qtyToInput(rule.defaultCount));
  const [problem, setProblem] = useState<string | null>(null);

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!changing) return void (await onConfirm());
    const value = parseUsedQty(count);
    if (value === null || value === 0) {
      return setProblem(t("staffMealError.count_invalid", {}, locale));
    }
    setProblem(null);
    if (await onConfirm(value)) setChanging(false);
  };

  return (
    <LedgerRow className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p id={nameId} className="num font-bold [overflow-wrap:anywhere]">
          {ruleLine(rule, locale)}
        </p>
        {!rule.isActive && <Badge tone="neutral">{t("staffMeal.inactive", {}, locale)}</Badge>}
      </div>
      {rule.isActive && rule.available !== null && (
        <p className="num text-sm text-ink-muted">
          {t("staffMeal.available", { count: formatCount(rule.available, locale) }, locale)}
        </p>
      )}
      {rule.isActive &&
        (rule.today ? (
          <p className="num text-sm">{confirmedLine(rule.today, locale)}</p>
        ) : (
          <form onSubmit={confirm} className="flex flex-col gap-2">
            {changing && (
              <Field
                label={t("staffMeal.todayQty", {}, locale)}
                hint={t("staffMeal.todayQtyHint", { unit: rule.unit }, locale)}
              >
                <TextInput
                  name="count"
                  inputMode="decimal"
                  autoComplete="off"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                />
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy} aria-describedby={nameId}>
                {t("staffMeal.confirm", {}, locale)}
              </Button>
              <Button
                variant="quiet"
                disabled={busy}
                aria-describedby={nameId}
                aria-expanded={changing}
                onClick={() => setChanging(!changing)}
              >
                {t("staffMeal.change", {}, locale)}
              </Button>
            </div>
          </form>
        ))}
      <ErrorAlert message={problem ?? error} />
      <div>
        <Button
          variant="quiet"
          disabled={busy}
          aria-describedby={nameId}
          onClick={() => onToggle(!rule.isActive)}
        >
          {t(rule.isActive ? "staffMeal.deactivate" : "staffMeal.activate", {}, locale)}
        </Button>
      </div>
    </LedgerRow>
  );
}
