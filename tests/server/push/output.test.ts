import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  chefForecastOutput,
  chefPushListOutput,
  discardsOutput,
  forecastOutput,
  managerForecastOutput,
  managerPushListOutput,
  pushListOutput,
  pushResultOutput,
} from "@/server/push/output";
import {
  DISCARDS,
  FORECAST_CHEF,
  FORECAST_OWNER,
  PUSH_LIST_CHEF,
  PUSH_LIST_OWNER,
  PUSH_RESULT,
} from "../../helpers/push-data";

describe("push payloads", () => {
  it("parse the shapes the SQL returns", () => {
    expect(pushListOutput.parse(PUSH_LIST_OWNER)).toEqual(PUSH_LIST_OWNER);
    expect(pushListOutput.parse({ ...PUSH_LIST_OWNER, role: "admin" })).toEqual({
      ...PUSH_LIST_OWNER,
      role: "admin",
    });
    expect(pushListOutput.parse(PUSH_LIST_CHEF)).toEqual(PUSH_LIST_CHEF);
    expect(forecastOutput.parse(FORECAST_OWNER)).toEqual(FORECAST_OWNER);
    expect(forecastOutput.parse(FORECAST_CHEF)).toEqual(FORECAST_CHEF);
    expect(discardsOutput.parse(DISCARDS)).toEqual(DISCARDS);
    expect(pushResultOutput.parse(PUSH_RESULT)).toEqual(PUSH_RESULT);
  });

  it("a chef push list that carries a cost at risk fails", () => {
    const row = { ...PUSH_LIST_CHEF.rows[0]!, costAtRiskEur: 1 };
    expect(chefPushListOutput.safeParse({ ...PUSH_LIST_CHEF, rows: [row] }).success).toBe(false);
  });

  it("a chef push list with a cost total fails", () => {
    const totals = { ...PUSH_LIST_CHEF.totals, costAtRiskEur: 1 };
    expect(chefPushListOutput.safeParse({ ...PUSH_LIST_CHEF, totals }).success).toBe(false);
  });

  it("a chef plate that carries a push price fails", () => {
    const row = PUSH_LIST_CHEF.rows[0]!;
    const rows = [{ ...row, plates: row.plates.map((p) => ({ ...p, pushPrice: 12 })) }];
    expect(chefPushListOutput.safeParse({ ...PUSH_LIST_CHEF, rows }).success).toBe(false);
  });

  it("a chef forecast that carries covers fails", () => {
    expect(
      chefForecastOutput.safeParse({ ...FORECAST_CHEF, covers: { expected: 31 } }).success,
    ).toBe(false);
  });

  it("a manager push list needs its cost keys, and the chef schema is not the manager's", () => {
    expect(managerPushListOutput.safeParse(PUSH_LIST_CHEF).success).toBe(false);
    expect(managerForecastOutput.safeParse(FORECAST_CHEF).success).toBe(false);
  });

  it("the nulls of unknown figures are accepted", () => {
    const empty = {
      ...FORECAST_OWNER,
      weeksUsed: 0,
      covers: { expected: null },
      batches: [{ ...FORECAST_OWNER.batches[0]!, expectedPortions: null, gap: null }],
      plates: [],
    };
    expect(forecastOutput.parse(empty)).toEqual(empty);
  });

  it("an unknown key anywhere is refused", () => {
    expect(
      discardsOutput.safeParse({ ...DISCARDS, rows: [{ ...DISCARDS.rows[0]!, unit_cost: 1 }] })
        .success,
    ).toBe(false);
    expect(discardsOutput.safeParse({ ...DISCARDS, extra: 1 }).success).toBe(false);
  });
});

// The JSON schema of each output is the contract with the screens and with the SQL: a key added or dropped changes the snapshot on purpose.
describe("output schemas (snapshots)", () => {
  it.each([
    ["managerPushListOutput", managerPushListOutput],
    ["chefPushListOutput", chefPushListOutput],
    ["managerForecastOutput", managerForecastOutput],
    ["chefForecastOutput", chefForecastOutput],
    ["discardsOutput", discardsOutput],
    ["pushResultOutput", pushResultOutput],
  ])("%s", (_name, schema) => {
    expect(z.toJSONSchema(schema as z.ZodType)).toMatchSnapshot();
  });
});
