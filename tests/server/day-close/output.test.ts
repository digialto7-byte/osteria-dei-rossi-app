import { describe, expect, it } from "vitest";
import { z } from "zod";
import { appVsRegisterOutput, enterDayCloseOutput } from "@/server/day-close/output";
import { ENTER_REPLY, REPORT, REPORT_NO_REGISTER } from "../../helpers/bill-data";

describe("day close payloads", () => {
  it("parse the shapes the SQL returns", () => {
    expect(appVsRegisterOutput.parse(REPORT)).toEqual(REPORT);
    expect(appVsRegisterOutput.parse(REPORT_NO_REGISTER)).toEqual(REPORT_NO_REGISTER);
    expect(enterDayCloseOutput.parse(ENTER_REPLY)).toEqual(ENTER_REPLY);
  });

  it("accept a null percentage (register total 0)", () => {
    expect(
      appVsRegisterOutput.parse({ ...REPORT, difference: { amount: 5, pct: null } }).difference
        ?.pct,
    ).toBeNull();
  });

  it("reject an injected key at any level", () => {
    expect(appVsRegisterOutput.safeParse({ ...REPORT, margin: 1 }).success).toBe(false);
    expect(
      appVsRegisterOutput.safeParse({ ...REPORT, app: { ...REPORT.app, cost: 1 } }).success,
    ).toBe(false);
    expect(
      appVsRegisterOutput.safeParse({ ...REPORT, openTables: { ...REPORT.openTables, x: 1 } })
        .success,
    ).toBe(false);
    expect(
      appVsRegisterOutput.safeParse({
        ...REPORT,
        missingReceipts: [{ ...REPORT.missingReceipts[0], guest: "x" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a payment or receipt type the database does not know", () => {
    const bad = {
      ...REPORT,
      app: { ...REPORT.app, byPaymentType: [{ type: "cheque", total: 1, tables: 1 }] },
    };
    expect(appVsRegisterOutput.safeParse(bad).success).toBe(false);
  });

  it("the JSON Schemas are stable", () => {
    expect(z.toJSONSchema(appVsRegisterOutput, { io: "output" })).toMatchSnapshot();
    expect(z.toJSONSchema(enterDayCloseOutput, { io: "output" })).toMatchSnapshot();
  });
});
