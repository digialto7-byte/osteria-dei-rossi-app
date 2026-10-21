/** Units a quantity can be entered in. Mass and volume each have a base and a small unit. */
export const MEASURE_UNITS = ["kg", "g", "l", "ml", "pz"] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/** Units ingredients are stored and costed in (plan §3.5: quantities in the base unit). */
export const BASE_UNITS = ["kg", "l", "pz"] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export type Dimension = "mass" | "volume" | "count";

interface UnitInfo {
  dimension: Dimension;
  /** How many base units one of this unit is. */
  toBaseFactor: number;
}

const UNIT_INFO: Record<MeasureUnit, UnitInfo> = {
  kg: { dimension: "mass", toBaseFactor: 1 },
  g: { dimension: "mass", toBaseFactor: 0.001 },
  l: { dimension: "volume", toBaseFactor: 1 },
  ml: { dimension: "volume", toBaseFactor: 0.001 },
  pz: { dimension: "count", toBaseFactor: 1 },
};

const BASE_OF: Record<Dimension, BaseUnit> = { mass: "kg", volume: "l", count: "pz" };

export function dimensionOf(unit: MeasureUnit): Dimension {
  return UNIT_INFO[unit].dimension;
}

export function baseUnitOf(unit: MeasureUnit): BaseUnit {
  return BASE_OF[UNIT_INFO[unit].dimension];
}

export function toBaseFactor(unit: MeasureUnit): number {
  return UNIT_INFO[unit].toBaseFactor;
}
