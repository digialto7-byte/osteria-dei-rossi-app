import { describe, expect, it } from "vitest";
import { buildFixedCostPeriods, type FixedCostRow } from "@/server/costing/fixed-costs";

const row = (id: string, month: string, createdAt: string, rent: number): FixedCostRow => ({
  id,
  month,
  rent,
  labour: 9000,
  utilities: 1500,
  created_at: createdAt,
});

describe("buildFixedCostPeriods", () => {
  it("puts months newest first and the newest entry of a month in force, the older superseded", () => {
    const periods = buildFixedCostPeriods([
      row("sep", "2026-09-01", "2026-09-30T08:00:00+00:00", 3000),
      row("oct-1", "2026-10-01", "2026-10-02T08:00:00+00:00", 3000),
      row("oct-2", "2026-10-01", "2026-10-20T08:00:00+00:00", 3500),
    ]);
    expect(periods.map((p) => p.id)).toEqual(["oct-2", "oct-1", "sep"]);
    expect(periods.map((p) => [p.inForce, p.superseded])).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
  });

  it("totals the three figures and renames them with the euro suffix", () => {
    const [period] = buildFixedCostPeriods([
      row("a", "2026-10-01", "2026-10-02T08:00:00+00:00", 3000),
    ]);
    expect(period).toEqual({
      id: "a",
      month: "2026-10-01",
      rentEur: 3000,
      labourEur: 9000,
      utilitiesEur: 1500,
      totalEur: 13500,
      createdAt: "2026-10-02T08:00:00+00:00",
      inForce: true,
      superseded: false,
    });
  });

  it("is independent of the order of the rows it is given", () => {
    const rows = [
      row("a", "2026-10-01", "2026-10-02T08:00:00+00:00", 1),
      row("b", "2026-10-01", "2026-10-20T08:00:00+00:00", 2),
      row("c", "2026-11-01", "2026-11-02T08:00:00+00:00", 3),
    ];
    expect(buildFixedCostPeriods([...rows].reverse())).toEqual(buildFixedCostPeriods(rows));
  });

  it("adds cents without floating point noise", () => {
    const [period] = buildFixedCostPeriods([
      {
        id: "a",
        month: "2026-10-01",
        rent: 0.1,
        labour: 0.2,
        utilities: 0,
        created_at: "2026-10-02T08:00:00Z",
      },
    ]);
    expect(period!.totalEur).toBe(0.3);
  });

  it("no rows is an empty list", () => {
    expect(buildFixedCostPeriods([])).toEqual([]);
  });
});
