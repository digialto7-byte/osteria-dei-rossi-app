import { COST_CHECK_TOLERANCE_PCT } from "./constants";

/** One row of the chef's sheet; `row` is the file line (CSV) or the position (JSON), from 1. */
export interface SheetRow {
  row: number;
  name: string;
  sheetEur: number;
}

/** A plate as the app costs it today; `foodCostEur` is null when the cost is incomplete. */
export interface AppPlate {
  recipeKey: string;
  name: string;
  foodCostEur: number | null;
}

export interface CostCheckResult {
  tolerancePct: number;
  compared: number;
  withinTolerance: number;
  listed: {
    row: number;
    name: string;
    recipeKey: string;
    appEur: number;
    sheetEur: number;
    diffPct: number;
  }[];
  unmatched: { row: number; name: string }[];
  duplicates: { row: number; name: string }[];
  incomplete: { row: number; name: string; recipeKey: string }[];
  invalid: { row: number; code: string }[];
}

// The same rule as app.normalise_name, which the unique index on recipe names uses.
const normalise = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Gate 1 (AT9): compares the chef's food cost per plate with the app's. A plate is listed when it
 * differs by MORE than the tolerance (exactly 5 % passes). Names that match nothing, appear twice,
 * have no complete app cost or have a sheet value of 0 or less are reported apart, never guessed.
 * Pure: the app costs come in as data.
 */
export function compareCostCheck(
  sheet: SheetRow[],
  plates: AppPlate[],
  tolerancePct: number = COST_CHECK_TOLERANCE_PCT,
): CostCheckResult {
  const result: CostCheckResult = {
    tolerancePct,
    compared: 0,
    withinTolerance: 0,
    listed: [],
    unmatched: [],
    duplicates: [],
    incomplete: [],
    invalid: [],
  };
  const byName = new Map(plates.map((plate) => [normalise(plate.name), plate]));
  const seen = new Map<string, number>();
  for (const row of sheet) {
    const name = normalise(row.name);
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }

  for (const row of sheet) {
    const name = normalise(row.name);
    if ((seen.get(name) ?? 0) > 1) {
      result.duplicates.push({ row: row.row, name: row.name });
      continue;
    }
    if (!Number.isFinite(row.sheetEur) || row.sheetEur <= 0) {
      result.invalid.push({ row: row.row, code: "invalid_value" });
      continue;
    }
    const plate = byName.get(name);
    if (!plate) {
      result.unmatched.push({ row: row.row, name: row.name });
      continue;
    }
    if (plate.foodCostEur === null) {
      result.incomplete.push({ row: row.row, name: row.name, recipeKey: plate.recipeKey });
      continue;
    }
    // Rounded before the comparison so that 1,05 against 1,00 is exactly 5 and not 5,000000000000004.
    const diff = ((plate.foodCostEur - row.sheetEur) / row.sheetEur) * 100;
    result.compared += 1;
    if (Math.abs(round(diff, 4)) > tolerancePct) {
      result.listed.push({
        row: row.row,
        name: row.name,
        recipeKey: plate.recipeKey,
        appEur: plate.foodCostEur,
        sheetEur: row.sheetEur,
        diffPct: round(diff, 2),
      });
    } else {
      result.withinTolerance += 1;
    }
  }
  return result;
}
