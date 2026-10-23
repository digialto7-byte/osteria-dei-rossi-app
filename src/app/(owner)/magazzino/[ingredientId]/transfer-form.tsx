"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorAlert, Field, Select } from "@/components/ui";
import { t } from "@/lib/i18n";
import { parseQtyInput } from "@/lib/stock/stock-view";
import type { StockInputUnit } from "@/server/stock/constants";
import type { BaseUnit, LotItem } from "@/server/stock/types";
import { QtyFields, lotOptions } from "./qty-fields";

export interface TransferValues {
  qty: number;
  unit: StockInputUnit;
  fromLocationId: string;
  toLocationId: string;
  lotId?: string;
}

/**
 * "Sposta tra ubicazioni": shown only when the venue has two or more locations. A secondary button, so the waste
 * form keeps the one primary action. The database refuses a transfer beyond the recorded stock (insufficient_stock).
 */
export function TransferForm({
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
  unit: BaseUnit;
  busy: boolean;
  onSubmit: (values: TransferValues) => void | boolean | Promise<boolean | void>;
}) {
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<string>(units[0] ?? "kg");
  const [from, setFrom] = useState(locations[0]?.id ?? "");
  const [to, setTo] = useState(locations[1]?.id ?? "");
  const [lotId, setLotId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (locations.length < 2) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseQtyInput(qty);
    if (parsed === null) return setProblem(t("stock.qty.invalid"));
    setProblem(null);
    const saved = await onSubmit({
      qty: parsed,
      unit: unit as StockInputUnit,
      fromLocationId: from,
      toLocationId: to,
      ...(lotId ? { lotId } : {}),
    });
    if (saved === true) {
      setQty("");
      setLotId("");
    }
  };

  const options = lotOptions(lots, from, baseUnit);
  const locationOptions = locations.map((location) => (
    <option key={location.id} value={location.id}>
      {location.name}
    </option>
  ));
  return (
    <form
      onSubmit={submit}
      aria-label={t("stock.transfer.title")}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule p-3"
    >
      <Field label={t("stock.transfer.from")}>
        <Select
          name="from"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setLotId("");
          }}
        >
          {locationOptions}
        </Select>
      </Field>
      <Field label={t("stock.transfer.to")}>
        <Select name="to" value={to} onChange={(event) => setTo(event.target.value)}>
          {locationOptions}
        </Select>
      </Field>
      <QtyFields
        labels={{ qty: "stock.transfer.qty", unit: "stock.transfer.unit" }}
        qty={qty}
        onQty={setQty}
        unit={unit}
        onUnit={setUnit}
        units={units}
      />
      <Field label={t("stock.transfer.lot")}>
        <Select name="lot" value={lotId} onChange={(event) => setLotId(event.target.value)}>
          <option value="">{t("stock.transfer.lotAuto")}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorAlert message={problem} />
      <div>
        <Button type="submit" variant="secondary" disabled={busy}>
          {t("stock.transfer.submit")}
        </Button>
      </div>
    </form>
  );
}
