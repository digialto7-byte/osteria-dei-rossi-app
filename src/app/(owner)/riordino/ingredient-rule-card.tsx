"use client";

import { useId, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Select,
  TextInput,
} from "@/components/ui";
import { FacetLinks } from "@/components/facet-links";
import { t } from "@/lib/i18n";
import { ruleIngredientAnchor, type FacetLink } from "@/lib/nav/facet-links";
import { toField } from "@/lib/numbers/parse-decimal";
import { choiceLabel, nextWindowLine, parseLevelInput, reasonWord } from "@/lib/rules/rules-view";
import { formatQty } from "@/lib/units/format";
import type { IngredientRulesItem } from "@/server/rules/output";
import { RuleFacts } from "./rule-facts";

export interface SupplierChoice {
  supplierItemId: string;
  ingredientId: string;
  supplierName: string;
  packLabel: string;
}

export interface IngredientRulesPatch {
  minLevel?: number | null;
  targetLevel?: number | null;
  preferredSupplierItemId?: string | null;
}

/** A decimal field with its unit as a suffix. The suffix sits outside the label, so the field's name is just the label. */
function LevelField({
  label,
  name,
  unit,
  value,
  disabled,
  onChange,
}: {
  label: string;
  name: string;
  unit: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.9375rem] font-bold text-ink">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <TextInput
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <span aria-hidden="true" className="text-ink-muted">
          {unit}
        </span>
      </div>
    </div>
  );
}

/**
 * One stock ingredient with its reorder rules. Owner and admin edit the minimum, the target and the preferred supplier
 * item; the chef reads the same values as text and keeps only the daily-count switch. It sends the fields that
 * changed; the status, the reasons and the next window are the server's words, never worked out here.
 */
export function IngredientRuleCard({
  item,
  choices,
  canEdit,
  busy,
  error,
  onSave,
  onCriticalChange,
  facets = [],
}: {
  item: IngredientRulesItem;
  choices: readonly SupplierChoice[];
  canEdit: boolean;
  busy: boolean;
  error: string | null;
  onSave: (patch: IngredientRulesPatch) => void;
  onCriticalChange: (checked: boolean) => void;
  /** Links to the same ingredient's other screens (record, stock, cost), chosen by the page for the role. */
  facets?: readonly FacetLink[];
}) {
  const [min, setMin] = useState(toField(item.minLevel));
  const [target, setTarget] = useState(toField(item.targetLevel));
  const [preferred, setPreferred] = useState(item.preferred?.supplierItemId ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const own = choices.filter((choice) => choice.ingredientId === item.ingredientId);
  const windowLine = nextWindowLine(item.nextWindow);
  const unit = item.baseUnit;

  function save() {
    const minRead = parseLevelInput(min);
    const targetRead = parseLevelInput(target);
    if (!minRead.ok || !targetRead.ok) return setLocalError(t("rules.error.number"));
    setLocalError(null);
    const patch: IngredientRulesPatch = {};
    if (minRead.value !== item.minLevel) patch.minLevel = minRead.value;
    if (targetRead.value !== item.targetLevel) patch.targetLevel = targetRead.value;
    const before = item.preferred?.supplierItemId ?? "";
    if (preferred !== before) patch.preferredSupplierItemId = preferred === "" ? null : preferred;
    if (Object.keys(patch).length > 0) onSave(patch);
  }

  const preferredText = item.preferred ? choiceLabel(item.preferred) : t("rules.none");

  return (
    <Card
      id={ruleIngredientAnchor(item.ingredientId)}
      role="group"
      aria-label={item.name}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-lg font-bold">{item.name}</p>
        <p className="num">{t("rules.onHand", { qty: formatQty(item.onHandQty, unit) })}</p>
        {item.status === "incomplete" && (
          <>
            <Badge tone="warning">{t("rules.status.incomplete")}</Badge>
            {item.reasons.map((reason) => (
              <p key={reason} className="text-sm text-ink-muted">
                {reasonWord(reason)}
              </p>
            ))}
          </>
        )}
        {item.status === "off" && <Badge tone="neutral">{t("rules.status.off")}</Badge>}
        {windowLine && <p className="num text-sm text-ink-muted">{windowLine}</p>}
      </div>

      {canEdit ? (
        <>
          <LevelField
            label={t("rules.min")}
            name={`min-${item.ingredientId}`}
            unit={unit}
            value={min}
            disabled={busy}
            onChange={setMin}
          />
          <LevelField
            label={t("rules.target")}
            name={`target-${item.ingredientId}`}
            unit={unit}
            value={target}
            disabled={busy}
            onChange={setTarget}
          />
          <Field label={t("rules.preferred")}>
            <Select
              name={`preferred-${item.ingredientId}`}
              value={preferred}
              disabled={busy}
              onChange={(event) => setPreferred(event.target.value)}
            >
              <option value="">{t("rules.preferred.none")}</option>
              {own.map((choice) => (
                <option key={choice.supplierItemId} value={choice.supplierItemId}>
                  {choiceLabel(choice)}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : (
        <RuleFacts
          rows={[
            {
              label: t("rules.min"),
              value: item.minLevel === null ? t("rules.none") : formatQty(item.minLevel, unit),
            },
            {
              label: t("rules.target"),
              value:
                item.targetLevel === null ? t("rules.none") : formatQty(item.targetLevel, unit),
            },
            { label: t("rules.preferred"), value: preferredText },
          ]}
        />
      )}

      <Checkbox
        label={t("rules.critical")}
        checked={item.isCritical}
        disabled={busy}
        onChange={(event) => onCriticalChange(event.target.checked)}
      />
      <FacetLinks links={facets} />
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
