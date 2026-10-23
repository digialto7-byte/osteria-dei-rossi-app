"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, Select } from "@/components/ui";
import { t } from "@/lib/i18n";
import { parseQtyInput } from "@/lib/stock/stock-view";
import type { StockInputUnit } from "@/server/stock/constants";
import { STOCK_REASON_CODES, reasonLabel, type StockReasonCode } from "@/server/stock/reasons";
import type { BaseUnit, LotItem } from "@/server/stock/types";
import { QtyFields, lotOptions } from "./qty-fields";

export interface WasteValues {
  qty: number;
  unit: StockInputUnit;
  reason: StockReasonCode;
  locationId?: string;
  lotId?: string;
}

/**
 * "Registra spreco": quantity, unit, reason, an optional lot (the first-expiring is recommended) and, when the venue
 * has two or more locations, the location. One primary button. It only reads what the chef typed; FEFO, the cost and
 * the negative-stock check are the database's. Resolves true from `onSubmit` when saved, so the form clears.
 */
export function WasteForm({
  units,
  locations,
  lots,
  unit: baseUnit,
  busy,
  onSubmit,
}: {
  units: readonly StockInputUnit[];
  locations: readonly { id: string; name: string }[];
  lots: readonly LotItem[];
  /** The ingredient's base unit, to word the quantities of the lots. */
  unit: BaseUnit;
  busy: boolean;
  onSubmit: (values: WasteValues) => void | boolean | Promise<boolean | void>;
}) {
  const several = locations.length >= 2;
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<string>(units[0] ?? "kg");
  const [reason, setReason] = useState("");
  const [lotId, setLotId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseQtyInput(qty);
    if (parsed === null) return setProblem(t("stock.qty.invalid"));
    if (!(STOCK_REASON_CODES as readonly string[]).includes(reason)) {
      return setProblem(t("stock.reasonRequired"));
    }
    setProblem(null);
    const saved = await onSubmit({
      qty: parsed,
      unit: unit as StockInputUnit,
      reason: reason as StockReasonCode,
      ...(several && locationId ? { locationId } : {}),
      ...(lotId ? { lotId } : {}),
    });
    if (saved === true) {
      setQty("");
      setReason("");
      setLotId("");
    }
  };

  const options = lotOptions(lots, several ? locationId : null, baseUnit);
  return (
    <form
      onSubmit={submit}
      aria-label={t("stock.waste.title")}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
    >
      <QtyFields
        labels={{ qty: "stock.waste.qty", unit: "stock.waste.unit" }}
        qty={qty}
        onQty={setQty}
        unit={unit}
        onUnit={setUnit}
        units={units}
      />
      <Field label={t("stock.waste.reason")}>
        <Select
          name="reason"
          value={reason}
          required
          onChange={(event) => setReason(event.target.value)}
        >
          <option value="">{t("stock.waste.reasonPlaceholder")}</option>
          {STOCK_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {reasonLabel(code)}
            </option>
          ))}
        </Select>
      </Field>
      {several && (
        <Field label={t("stock.waste.location")}>
          <Select
            name="location"
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setLotId("");
            }}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("stock.waste.lot")}>
        <Select name="lot" value={lotId} onChange={(event) => setLotId(event.target.value)}>
          <option value="">{t("stock.waste.lotAuto")}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorAlert message={problem} />
      <div>
        <Button type="submit" disabled={busy}>
          {t("stock.waste.submit")}
        </Button>
      </div>
    </form>
  );
}
