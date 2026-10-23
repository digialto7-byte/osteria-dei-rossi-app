import { Field, Select, TextInput } from "@/components/ui";
import { t, type MessageKey } from "@/lib/i18n";
import { formatStockQty } from "@/lib/stock/stock-view";
import type { StockInputUnit } from "@/server/stock/constants";
import type { BaseUnit, LotItem } from "@/server/stock/types";

/** The quantity and unit fields shared by the waste and the transfer forms. */
export function QtyFields({
  labels,
  qty,
  onQty,
  unit,
  onUnit,
  units,
}: {
  labels: { qty: MessageKey; unit: MessageKey };
  qty: string;
  onQty: (value: string) => void;
  unit: string;
  onUnit: (value: string) => void;
  units: readonly StockInputUnit[];
}) {
  return (
    <>
      <Field label={t(labels.qty)}>
        <TextInput
          name="qty"
          inputMode="decimal"
          autoComplete="off"
          required
          value={qty}
          onChange={(event) => onQty(event.target.value)}
        />
      </Field>
      <Field label={t(labels.unit)}>
        <Select name="unit" value={unit} onChange={(event) => onUnit(event.target.value)}>
          {units.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/**
 * The lots the chef may name: those with stock, and, when the venue has several locations, those at the chosen
 * one. The label carries the code, the location and what is left (the server's figure).
 */
export function lotOptions(lots: readonly LotItem[], locationId: string | null, unit: BaseUnit) {
  return lots
    .filter(
      (lot) =>
        lot.rawLotId !== null &&
        lot.onHandQty > 0 &&
        (locationId === null || lot.locationId === locationId),
    )
    .map((lot) => ({
      id: lot.rawLotId!,
      label: `${lot.lotCode ?? t("stock.lot.noCode")} · ${lot.locationName} · ${formatStockQty(lot.onHandQty, unit)}`,
    }));
}
