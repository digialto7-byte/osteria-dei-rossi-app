import { Field, Select, TextInput } from "@/components/ui";
import { formatProposedQty } from "@/lib/batches/batch-view";
import { t } from "@/lib/i18n";
import { formatCalendarDate } from "@/lib/time/format";
import { formatStockQty } from "@/lib/stock/stock-view";
import type { ProposalInput, ProposalLot } from "@/server/batches/types";

/** What the chef has typed or chosen for one ingredient; the form holds it, the row only shows it. */
export interface InputRowValue {
  qty: string;
  unit: string;
  locationId: string;
  lotId: string;
}

type Place = { id: string; name: string };

/** The lots the chef may name: those with stock, and, with several places, those at the chosen one. */
function lotChoices(input: ProposalInput, locationId: string | null) {
  return input.lots
    .filter(
      (lot): lot is ProposalLot & { rawLotId: string } =>
        lot.rawLotId !== null &&
        lot.onHandQty > 0 &&
        (locationId === null || lot.locationId === locationId),
    )
    .map((lot) => {
      const expiry =
        lot.expiry === null
          ? t("production.lot.noExpiry")
          : t(lot.expiryState === "expired" ? "production.lot.expired" : "production.lot.expires", {
              date: formatCalendarDate(lot.expiry),
            });
      return {
        id: lot.rawLotId,
        label: t("production.lotOption", {
          code: lot.lotCode ?? t("production.lot.noCode"),
          expiry,
          qty: formatStockQty(lot.onHandQty, input.baseUnit),
        }),
      };
    });
}

/**
 * One ingredient of the proposal: the proposed quantity, what is in stock, and the fields to confirm what was really
 * used (quantity, unit, place, an optional lot). An ingredient that is not in stock (water) is shown but never
 * deducted. It only shows what the API sent; FEFO and the quantities are the database's.
 */
export function InputRow({
  input,
  locations,
  value,
  error,
  onChange,
}: {
  input: ProposalInput;
  locations: readonly Place[];
  value: InputRowValue;
  error: string | null;
  onChange: (patch: Partial<InputRowValue>) => void;
}) {
  const several = locations.length >= 2;
  // The lots offered are those at the chosen place (with one place, that one).
  const place = value.locationId || (locations.length === 1 ? locations[0]!.id : "");
  const nameOf = (id: string) => locations.find((entry) => entry.id === id)?.name ?? "";
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-rule p-3">
      <p className="font-bold [overflow-wrap:anywhere]">{input.name}</p>
      <p className="num text-ink-muted">
        {t("production.proposed", { qty: formatProposedQty(input.proposedQty, input.baseUnit) })}
      </p>
      {!input.isStock ? (
        <p className="text-ink-muted">{t("production.notStock")}</p>
      ) : (
        <>
          <p className="num text-ink-muted">
            {input.onHand.length === 0
              ? t("production.onHandNone")
              : t("production.onHand", {
                  places: input.onHand
                    .map(
                      (h) =>
                        `${nameOf(h.locationId)} ${formatStockQty(h.onHandQty, input.baseUnit)}`,
                    )
                    .join(" · "),
                })}
          </p>
          <Field label={t("production.used")}>
            <TextInput
              name="qty"
              inputMode="decimal"
              autoComplete="off"
              required
              value={value.qty}
              aria-invalid={error ? true : undefined}
              onChange={(event) => onChange({ qty: event.target.value })}
            />
          </Field>
          {error && <p className="text-sm leading-snug text-danger">{error}</p>}
          <Field label={t("production.unit")}>
            <Select
              name="unit"
              value={value.unit}
              onChange={(event) => onChange({ unit: event.target.value })}
            >
              {input.units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
          {several && (
            <Field label={t("production.location")}>
              <Select
                name="location"
                value={value.locationId}
                onChange={(event) => onChange({ locationId: event.target.value, lotId: "" })}
              >
                {locations.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("production.lot")}>
            <Select
              name="lot"
              value={value.lotId}
              onChange={(event) => onChange({ lotId: event.target.value })}
            >
              <option value="">{t("production.lotAuto")}</option>
              {lotChoices(input, place || null).map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </li>
  );
}
