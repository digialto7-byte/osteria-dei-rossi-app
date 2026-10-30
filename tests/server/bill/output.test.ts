import { describe, expect, it } from "vitest";
import { z } from "zod";
import { billOutput, closeOutput } from "@/server/bill/output";
import {
  BILL,
  BILL_BY_COVERS,
  BILL_BY_ITEMS,
  BILL_CLOSED,
  CLOSE_REPLY,
} from "../../helpers/bill-data";

function propertyNames(schema: z.ZodType): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.properties && typeof record.properties === "object")
        names.push(...Object.keys(record.properties));
      Object.values(record).forEach(walk);
    }
  };
  walk(z.toJSONSchema(schema, { io: "output" }));
  return names;
}

describe("bill payloads", () => {
  it("parse the shapes the SQL returns", () => {
    for (const bill of [BILL, BILL_BY_COVERS, BILL_BY_ITEMS, BILL_CLOSED])
      expect(billOutput.parse(bill)).toEqual(bill);
    expect(closeOutput.parse(CLOSE_REPLY)).toEqual(CLOSE_REPLY);
  });

  it("have no cost, margin, GP, food, recipe or VAT key at any depth (a waiter reads them)", () => {
    for (const schema of [billOutput, closeOutput]) {
      const names = propertyNames(schema);
      expect(names.length).toBeGreaterThan(10);
      expect(names.filter((n) => /cost|margin|gp|food|recipe|vat/i.test(n))).toEqual([]);
    }
  });

  it.each(["unitCost", "margin", "cost", "recipeKey", "vatRate"])(
    "an injected %s on a line fails the strict parse",
    (key) => {
      const line = { ...BILL.lines[0], [key]: 1 };
      expect(billOutput.safeParse({ ...BILL, lines: [line] }).success).toBe(false);
    },
  );

  it("an injected key on the bill, the coperto or the receipt fails the strict parse", () => {
    expect(billOutput.safeParse({ ...BILL, cost: 1 }).success).toBe(false);
    expect(billOutput.safeParse({ ...BILL, coperto: { ...BILL.coperto, vat: 10 } }).success).toBe(
      false,
    );
    expect(
      billOutput.safeParse({ ...BILL_CLOSED, receipt: { ...BILL_CLOSED.receipt, margin: 1 } })
        .success,
    ).toBe(false);
  });

  it("a coperto of null is a bill without coperto", () => {
    expect(billOutput.parse({ ...BILL, coperto: null }).coperto).toBeNull();
  });

  it("a draft line is accepted and a voided one is not (voided lines are never billed)", () => {
    expect(
      billOutput.safeParse({ ...BILL, lines: [{ ...BILL.lines[0], state: "draft" }] }).success,
    ).toBe(true);
    expect(
      billOutput.safeParse({ ...BILL, lines: [{ ...BILL.lines[0], state: "voided" }] }).success,
    ).toBe(false);
  });

  it("the JSON Schema of the bill is stable", () => {
    expect(z.toJSONSchema(billOutput, { io: "output" })).toMatchSnapshot();
  });

  it("the JSON Schema of the close reply is stable", () => {
    expect(z.toJSONSchema(closeOutput, { io: "output" })).toMatchSnapshot();
  });
});
