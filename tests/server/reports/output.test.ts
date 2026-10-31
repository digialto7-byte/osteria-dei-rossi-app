import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminItemsOutput,
  avtOutput,
  itemsOutput,
  kpiReportOutput,
  ownerItemsOutput,
  unmappedOutput,
} from "@/server/reports/output";
import { AVT, ITEMS_ADMIN, ITEMS_OWNER, KPI_REPORT, UNMAPPED } from "../../helpers/report-data";

describe("report payloads", () => {
  it("parse the shapes the SQL returns", () => {
    expect(kpiReportOutput.parse(KPI_REPORT)).toEqual(KPI_REPORT);
    expect(itemsOutput.parse(ITEMS_OWNER)).toEqual(ITEMS_OWNER);
    expect(itemsOutput.parse(ITEMS_ADMIN)).toEqual(ITEMS_ADMIN);
    expect(avtOutput.parse(AVT)).toEqual(AVT);
    expect(unmappedOutput.parse(UNMAPPED)).toEqual(UNMAPPED);
  });

  it("accept the nulls of unknown figures", () => {
    const empty = {
      ...KPI_REPORT,
      current: {
        ...KPI_REPORT.current,
        covers: 0,
        tables: 0,
        avgSpendPerCoverEur: null,
        avgTicketEur: null,
        foodCostPct: null,
        costedSharePct: null,
        appVsRegister: {
          ...KPI_REPORT.current.appVsRegister,
          registerTotalEur: null,
          difference: null,
        },
      },
      delta: { ...KPI_REPORT.delta, avgSpendPerCoverEur: null, foodCostPct: null },
    };
    expect(kpiReportOutput.safeParse(empty).success).toBe(true);
  });

  it("a huge or negative percentage never fails the parse (a tiny previous value gives +124900,0)", () => {
    const huge = {
      ...KPI_REPORT,
      current: {
        ...KPI_REPORT.current,
        foodCostPct: 987654.3,
        appVsRegister: {
          ...KPI_REPORT.current.appVsRegister,
          difference: { amount: 5, pct: -250000.5 },
        },
      },
      delta: {
        ...KPI_REPORT.delta,
        wasteEur: { abs: 49.96, pct: 124900.0 },
        covers: { abs: -5, pct: -999999.9 },
      },
    };
    expect(kpiReportOutput.safeParse(huge).success).toBe(true);
    const row = { ...ITEMS_OWNER.rows[0]!, mixPct: 150000.1, foodCostPct: 400000 };
    const items = { ...ITEMS_OWNER, totals: { ...ITEMS_OWNER.totals, foodCostPct: 500000 } };
    expect(itemsOutput.safeParse({ ...items, rows: [row] }).success).toBe(true);
  });

  it("the report refuses an injected key at any level", () => {
    expect(kpiReportOutput.safeParse({ ...KPI_REPORT, unit_cost: 1 }).success).toBe(false);
    expect(
      kpiReportOutput.safeParse({ ...KPI_REPORT, current: { ...KPI_REPORT.current, margin: 1 } })
        .success,
    ).toBe(false);
    expect(
      kpiReportOutput.safeParse({
        ...KPI_REPORT,
        current: { ...KPI_REPORT.current, waste: { ...KPI_REPORT.current.waste, lines: [] } },
      }).success,
    ).toBe(false);
    expect(
      kpiReportOutput.safeParse({ ...KPI_REPORT, delta: { ...KPI_REPORT.delta, staff: null } })
        .success,
    ).toBe(false);
  });

  it("the report needs one delta entry per DELTA_KEYS", () => {
    const { covers: _covers, ...rest } = KPI_REPORT.delta;
    expect(kpiReportOutput.safeParse({ ...KPI_REPORT, delta: rest }).success).toBe(false);
  });

  it("an admin item row with a fixed-cost key fails", () => {
    const row = { ...ITEMS_ADMIN.rows[0]!, fixedCostPerPlateEur: 5 };
    expect(adminItemsOutput.safeParse({ ...ITEMS_ADMIN, rows: [row] }).success).toBe(false);
    for (const key of ["grossMarginPerPlateEur", "contributionEur", "fixedCostReason"]) {
      const bad = { ...ITEMS_ADMIN.rows[0]!, [key]: null };
      expect(itemsOutput.safeParse({ ...ITEMS_ADMIN, rows: [bad] }).success, key).toBe(false);
    }
  });

  it("an owner reply with the role admin fails, and the other way round", () => {
    expect(itemsOutput.safeParse({ ...ITEMS_OWNER, role: "admin" }).success).toBe(false);
    expect(itemsOutput.safeParse({ ...ITEMS_ADMIN, role: "owner" }).success).toBe(false);
    expect(ownerItemsOutput.safeParse(ITEMS_ADMIN).success).toBe(false);
  });

  it("an injected unit_cost fails in an item row and in an AVT row", () => {
    const itemRow = { ...ITEMS_OWNER.rows[0]!, unit_cost: 4.2 };
    expect(itemsOutput.safeParse({ ...ITEMS_OWNER, rows: [itemRow] }).success).toBe(false);
    const avtRow = { ...AVT.rows[0]!, unit_cost: 12 };
    expect(avtOutput.safeParse({ ...AVT, rows: [avtRow] }).success).toBe(false);
  });

  it("refuses a status or a reason the database does not know", () => {
    const row = { ...ITEMS_ADMIN.rows[0]!, status: "free" };
    expect(itemsOutput.safeParse({ ...ITEMS_ADMIN, rows: [row] }).success).toBe(false);
    const owner = { ...ITEMS_OWNER.rows[0]!, fixedCostReason: "rent" };
    expect(itemsOutput.safeParse({ ...ITEMS_OWNER, rows: [owner] }).success).toBe(false);
  });

  it("the hour and weekday arrays have 24 and 7 entries", () => {
    const short = { ...KPI_REPORT.current, coversByHour: KPI_REPORT.current.coversByHour.slice(1) };
    expect(kpiReportOutput.safeParse({ ...KPI_REPORT, current: short }).success).toBe(false);
    const week = { ...KPI_REPORT.current, coversByWeekday: [1, 2] };
    expect(kpiReportOutput.safeParse({ ...KPI_REPORT, current: week }).success).toBe(false);
  });

  it("the JSON Schemas are stable", () => {
    expect(z.toJSONSchema(kpiReportOutput, { io: "output" })).toMatchSnapshot();
    expect(z.toJSONSchema(itemsOutput, { io: "output" })).toMatchSnapshot();
    expect(z.toJSONSchema(avtOutput, { io: "output" })).toMatchSnapshot();
    expect(z.toJSONSchema(unmappedOutput, { io: "output" })).toMatchSnapshot();
  });
});
