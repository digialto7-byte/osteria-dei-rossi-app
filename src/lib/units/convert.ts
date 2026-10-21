import { baseUnitOf, dimensionOf, toBaseFactor, type BaseUnit, type MeasureUnit } from "./units";

export type UnitErrorCode = "incompatible_units" | "invalid_pack" | "invalid_quantity";

export class UnitError extends Error {
  constructor(public readonly code: UnitErrorCode) {
    super(code);
    this.name = "UnitError";
  }
}

/** One purchase pack, e.g. a "cassa" of 6 × 1 kg: count 6, size 1, unit kg. */
export interface PackSpec {
  count: number;
  size: number;
  unit: MeasureUnit;
}

/** A quantity in a measure unit, or in whole purchase packs ("conf"). */
export type QuantityUnit = MeasureUnit | "conf";

export interface BaseQuantity {
  qty: number;
  unit: BaseUnit;
}

// Quantities are numeric(12,4) in the database (plan §3.5).
const SCALE = 10_000;
// Rounding the scaled value to 12 significant digits first removes binary noise such as
// 0.05 * 0.001 * 10000 = 0.49999999999999994, so half-up rounding behaves as on paper.
function round4(value: number): number {
  return Math.round(Number((value * SCALE).toPrecision(12))) / SCALE + 0;
}

function assertPositive(value: number, code: UnitErrorCode): void {
  if (!Number.isFinite(value) || value <= 0) throw new UnitError(code);
}

export function convert(qty: number, from: MeasureUnit, to: MeasureUnit): number {
  if (!Number.isFinite(qty)) throw new UnitError("invalid_quantity");
  if (dimensionOf(from) !== dimensionOf(to)) throw new UnitError("incompatible_units");
  return round4((qty * toBaseFactor(from)) / toBaseFactor(to));
}

/** Converts a quantity to its base unit; `conf` needs the pack it refers to. */
export function toBase(qty: number, unit: QuantityUnit, pack?: PackSpec): BaseQuantity {
  if (!Number.isFinite(qty)) throw new UnitError("invalid_quantity");
  if (unit !== "conf") {
    return { qty: round4(qty * toBaseFactor(unit)), unit: baseUnitOf(unit) };
  }
  if (!pack) throw new UnitError("invalid_pack");
  assertPositive(pack.count, "invalid_pack");
  assertPositive(pack.size, "invalid_pack");
  return {
    qty: round4(qty * pack.count * pack.size * toBaseFactor(pack.unit)),
    unit: baseUnitOf(pack.unit),
  };
}

/** Like toBase, but the result must be in the ingredient's own base unit. */
export function toIngredientBase(
  qty: number,
  unit: QuantityUnit,
  ingredientBaseUnit: BaseUnit,
  pack?: PackSpec,
): BaseQuantity {
  const result = toBase(qty, unit, pack);
  if (result.unit !== ingredientBaseUnit) throw new UnitError("incompatible_units");
  return result;
}
