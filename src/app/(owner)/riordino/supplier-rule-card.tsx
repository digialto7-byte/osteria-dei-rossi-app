"use client";

import { useState } from "react";
import { Button, Card, Checkbox, ErrorAlert, Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  nextWindowLine,
  parseWholeInput,
  weekdayLabels,
  weekdayList,
} from "@/lib/rules/rules-view";
import { RULES_LEAD_TIME_MAX } from "@/server/rules/constants";
import type { SupplierRulesItem } from "@/server/rules/output";
import { RuleFacts } from "./rule-facts";

export interface SupplierRulesPatch {
  leadTimeDays?: number | null;
  deliveryWeekdays?: number[];
  orderCutoffTime?: string | null;
}

const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((day, index) => day === b[index]);

/**
 * One supplier with its delivery rules: lead time, delivery weekdays and the order cut-off. Owner and admin edit them;
 * the chef reads them as text. It sends the fields that changed; the next window is the server's line, shown as given.
 */
export function SupplierRuleCard({
  item,
  canEdit,
  busy,
  error,
  onSave,
}: {
  item: SupplierRulesItem;
  canEdit: boolean;
  busy: boolean;
  error: string | null;
  onSave: (patch: SupplierRulesPatch) => void;
}) {
  const [lead, setLead] = useState(item.leadTimeDays === null ? "" : String(item.leadTimeDays));
  const [days, setDays] = useState<number[]>(item.deliveryWeekdays);
  const [cutoff, setCutoff] = useState(item.orderCutoffTime ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const windowLine = nextWindowLine(item.nextWindow);

  function toggle(day: number, checked: boolean) {
    setDays((current) =>
      (checked ? [...current, day] : current.filter((d) => d !== day)).sort((a, b) => a - b),
    );
  }

  function save() {
    const leadRead = parseWholeInput(lead, RULES_LEAD_TIME_MAX);
    if (!leadRead.ok) return setLocalError(t("rules.error.integer"));
    setLocalError(null);
    const patch: SupplierRulesPatch = {};
    if (leadRead.value !== item.leadTimeDays) patch.leadTimeDays = leadRead.value;
    if (!sameDays(days, item.deliveryWeekdays)) patch.deliveryWeekdays = days;
    const nextCutoff = cutoff === "" ? null : cutoff;
    if (nextCutoff !== item.orderCutoffTime) patch.orderCutoffTime = nextCutoff;
    if (Object.keys(patch).length > 0) onSave(patch);
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-lg font-bold">{item.name}</p>
        {windowLine && <p className="num text-sm text-ink-muted">{windowLine}</p>}
      </div>
      {canEdit ? (
        <>
          <Field label={t("rules.lead")}>
            <TextInput
              name={`lead-${item.supplierId}`}
              type="text"
              inputMode="numeric"
              value={lead}
              disabled={busy}
              onChange={(event) => setLead(event.target.value)}
            />
          </Field>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-0 border-0 p-0">
            <legend className="mb-1 text-[0.9375rem] font-bold text-ink">{t("rules.days")}</legend>
            {weekdayLabels().map((day) => (
              <Checkbox
                key={day.value}
                name={`day-${item.supplierId}-${day.value}`}
                label={day.label}
                checked={days.includes(day.value)}
                disabled={busy}
                onChange={(event) => toggle(day.value, event.target.checked)}
              />
            ))}
          </fieldset>
          <Field label={t("rules.cutoff")}>
            <TextInput
              name={`cutoff-${item.supplierId}`}
              type="time"
              value={cutoff}
              disabled={busy}
              onChange={(event) => setCutoff(event.target.value)}
            />
          </Field>
        </>
      ) : (
        <RuleFacts
          rows={[
            {
              label: t("rules.lead"),
              value: item.leadTimeDays === null ? t("rules.none") : String(item.leadTimeDays),
            },
            { label: t("rules.days"), value: weekdayList(item.deliveryWeekdays) },
            { label: t("rules.cutoff"), value: item.orderCutoffTime ?? t("rules.none") },
          ]}
        />
      )}
      <ErrorAlert message={error ?? localError} />
      {canEdit && (
        <div>
          <Button variant="secondary" disabled={busy} onClick={save}>
            {t("rules.save")}
          </Button>
        </div>
      )}
    </Card>
  );
}
