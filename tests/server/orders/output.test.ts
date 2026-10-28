import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  addLineOutput,
  conflictDetails,
  lineWriteResult,
  itemUnavailableDetails,
  lineWriteOutput,
  orderLine,
  orderViewOutput,
} from "@/server/orders/output";
import { ADD_REPLY, LINE_SOUP, LINE_STEW, OIDS, ORDER_VIEW } from "../../helpers/orders-data";

// Every property name of a schema, at any depth, through its JSON Schema.
function propertyNames(schema: z.ZodType): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.properties && typeof record.properties === "object") {
        names.push(...Object.keys(record.properties));
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(z.toJSONSchema(schema, { io: "output" }));
  return names;
}

// What a waiter may never see (plan §3.1.9). A sale price (unitPrice) is allowed; VAT, cost and recipe identity are not.
const WAITER_FORBIDDEN = /cost|margin|gp|food|eur$|recipe|vat/i;

const SCHEMAS = {
  orderViewOutput,
  addLineOutput,
  lineWriteOutput,
  conflictDetails,
  itemUnavailableDetails,
};

describe("waiter order payloads", () => {
  it.each(Object.entries(SCHEMAS))(
    "%s has no cost, margin, GP, food, EUR, recipe or VAT key",
    (_n, schema) => {
      const names = propertyNames(schema);
      expect(names.length).toBeGreaterThan(2);
      expect(names.filter((name) => WAITER_FORBIDDEN.test(name))).toEqual([]);
    },
  );

  it.each(Object.entries(SCHEMAS))(
    "%s matches the committed JSON Schema (a change is deliberate)",
    (_n, schema) => {
      expect(z.toJSONSchema(schema, { io: "output" })).toMatchSnapshot();
    },
  );
});

describe("orderLine", () => {
  it("has exactly the thirteen keys of the plan", () => {
    expect(Object.keys(orderLine.shape).sort()).toEqual(
      [
        "clientUpdatedAt",
        "course",
        "id",
        "isShared",
        "menuItemId",
        "name",
        "note",
        "qty",
        "segue",
        "state",
        "unitPrice",
        "updatedAt",
        "updatedBy",
      ].sort(),
    );
  });

  it("parses the database shape, with half portions and a note", () => {
    expect(orderLine.parse(LINE_SOUP)).toEqual(LINE_SOUP);
    expect(orderLine.parse(LINE_STEW)).toEqual(LINE_STEW);
  });

  it.each(["draft", "fired", "voided"])("accepts the state %s", (state) => {
    expect(orderLine.safeParse({ ...LINE_STEW, state }).success).toBe(true);
  });

  it.each([
    ["an unknown state", { state: "paid" }],
    ["a cost", { unit_cost: 3 }],
    ["a margin", { margin_eur: 9 }],
    ["a VAT rate", { vatRate: 10 }],
    ["a price source", { priceSource: "push" }],
    ["a recipe key", { recipeKey: OIDS.item }],
    ["a quantity as text", { qty: "2" }],
  ])("refuses a line with %s", (_name, extra) => {
    expect(orderLine.safeParse({ ...LINE_STEW, ...extra }).success).toBe(false);
  });

  it("refuses an editor with an extra key", () => {
    const line = { ...LINE_STEW, updatedBy: { ...LINE_STEW.updatedBy, pin: "1234" } };
    expect(orderLine.safeParse(line).success).toBe(false);
  });
});

describe("orderViewOutput", () => {
  it("parses a session with its lines", () => {
    expect(orderViewOutput.parse(ORDER_VIEW)).toEqual(ORDER_VIEW);
  });

  it("has exactly the seven session keys", () => {
    expect(Object.keys(orderViewOutput.shape.session.shape).sort()).toEqual(
      ["billRequested", "closed", "covers", "id", "status", "tableId", "tableName"].sort(),
    );
  });

  it("refuses an unknown status and a stray key", () => {
    const bad = { ...ORDER_VIEW, session: { ...ORDER_VIEW.session, status: "paid" } };
    expect(orderViewOutput.safeParse(bad).success).toBe(false);
    expect(orderViewOutput.safeParse({ ...ORDER_VIEW, total: 1 }).success).toBe(false);
  });
});

describe("write replies", () => {
  it("addLineOutput carries created, the line and the item's stock", () => {
    expect(addLineOutput.parse(ADD_REPLY)).toEqual(ADD_REPLY);
    const noLimit = {
      ...ADD_REPLY,
      item: { ...ADD_REPLY.item, portionsLeft: null, lowStock: false },
    };
    expect(addLineOutput.safeParse(noLimit).success).toBe(true);
    expect(
      addLineOutput.safeParse({ ...ADD_REPLY, item: { ...ADD_REPLY.item, cost: 1 } }).success,
    ).toBe(false);
  });

  it("the item carries the database's unavailable reason (null when available), never a guess", () => {
    const manual = {
      ...ADD_REPLY,
      item: { ...ADD_REPLY.item, available: false, unavailableReason: "manual" },
    };
    expect(addLineOutput.parse(manual).item.unavailableReason).toBe("manual");
    const { unavailableReason: _gone, ...without } = ADD_REPLY.item;
    expect(addLineOutput.safeParse({ ...ADD_REPLY, item: without }).success).toBe(false);
    expect(
      addLineOutput.safeParse({
        ...ADD_REPLY,
        item: { ...ADD_REPLY.item, unavailableReason: "later" },
      }).success,
    ).toBe(false);
  });

  it("lineWriteOutput carries changed and the line", () => {
    expect(lineWriteOutput.parse({ changed: false, line: LINE_STEW })).toEqual({
      changed: false,
      line: LINE_STEW,
    });
    expect(lineWriteOutput.safeParse({ line: LINE_STEW }).success).toBe(false);
  });
});

describe("lineWriteResult (edit and remove replies)", () => {
  it("accepts a written line and a conflict result, nothing else", () => {
    expect(lineWriteResult.safeParse({ changed: true, line: LINE_STEW }).success).toBe(true);
    expect(
      lineWriteResult.safeParse({ conflict: { reason: "stale", line: LINE_STEW } }).success,
    ).toBe(true);
    expect(
      lineWriteResult.safeParse({ conflict: { reason: "later", line: LINE_STEW } }).success,
    ).toBe(false);
    expect(
      lineWriteResult.safeParse({ conflict: { reason: "stale", line: LINE_STEW }, x: 1 }).success,
    ).toBe(false);
    expect(lineWriteResult.safeParse({}).success).toBe(false);
  });
});

describe("error details", () => {
  it.each(["stale", "fired", "voided", "session_closed"])("conflict reason %s", (reason) => {
    expect(conflictDetails.safeParse({ reason, line: LINE_STEW }).success).toBe(true);
  });

  it("conflict refuses an unknown reason, a missing line and extra keys", () => {
    expect(conflictDetails.safeParse({ reason: "later", line: LINE_STEW }).success).toBe(false);
    expect(conflictDetails.safeParse({ reason: "stale" }).success).toBe(false);
    expect(conflictDetails.safeParse({ reason: "stale", line: LINE_STEW, x: 1 }).success).toBe(
      false,
    );
  });

  it("item_unavailable carries the item, the reason and the portions left", () => {
    const detail = { menuItemId: OIDS.item, reason: "no_portions", portionsLeft: 0 };
    expect(itemUnavailableDetails.parse(detail)).toEqual(detail);
    expect(
      itemUnavailableDetails.safeParse({ ...detail, reason: "manual", portionsLeft: null }).success,
    ).toBe(true);
    expect(itemUnavailableDetails.safeParse({ ...detail, reason: "later" }).success).toBe(false);
  });
});
