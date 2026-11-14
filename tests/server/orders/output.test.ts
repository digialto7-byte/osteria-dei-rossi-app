import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  fireOutput,
  SKIP_REASONS,
  addLineOutput,
  conflictDetails,
  lineWriteResult,
  itemUnavailableDetails,
  lineWriteOutput,
  orderLine,
  orderViewOutput,
} from "@/server/orders/output";
import { sessionCoperto } from "@/server/tables/output";
import {
  ADD_REPLY,
  LINE_SOUP,
  LINE_STEAK,
  LINE_STEW,
  OIDS,
  ORDER_VIEW,
  ORDER_VIEW_NO_COPERTO,
} from "../../helpers/orders-data";

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

// Every property path of a schema, dotted from the root, through its JSON Schema. Wrappers (anyOf for a nullable, items for an array,
// allOf, $defs) add no segment, so `session.coperto.vatRate` is the path whether coperto is nullable or not.
function propertyPaths(schema: z.ZodType): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, prefix: string): void => {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, prefix));
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "properties" && value && typeof value === "object") {
          for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
            const path = prefix === "" ? name : `${prefix}.${name}`;
            paths.push(path);
            walk(child, path);
          }
        } else {
          walk(value, prefix);
        }
      }
    }
  };
  walk(z.toJSONSchema(schema, { io: "output" }), "");
  return paths;
}

// What a waiter may never see (plan §3.1.9). A sale price (unitPrice) is allowed; VAT, cost and recipe identity are not.
const WAITER_FORBIDDEN = /cost|margin|gp|food|eur$|recipe|vat/i;

// The exact paths that match WAITER_FORBIDDEN and are allowed anyway, per schema (DS-BQ-2, lead decision Q-D1): the coperto's VAT rate is a
// sale fact the waiter already sees on the tile. An exact path, never a key name: a vatRate anywhere else in the same schema is still refused.
const SCHEMA_SALE_PATHS: Record<string, string[]> = {
  orderViewOutput: ["session.coperto.vatRate"],
};
const lastName = (path: string): string => path.slice(path.lastIndexOf(".") + 1);
const forbiddenPaths = (name: string, schema: z.ZodType): string[] =>
  propertyPaths(schema).filter(
    (path) =>
      WAITER_FORBIDDEN.test(lastName(path)) && !(SCHEMA_SALE_PATHS[name] ?? []).includes(path),
  );

const SCHEMAS = {
  fireOutput,
  orderViewOutput,
  addLineOutput,
  lineWriteOutput,
  conflictDetails,
  itemUnavailableDetails,
};

describe("waiter order payloads", () => {
  it.each(Object.entries(SCHEMAS))(
    "%s has no cost, margin, GP, food, EUR, recipe or VAT key outside its exempt path (session.coperto.vatRate on orderViewOutput only)",
    (name, schema) => {
      expect(propertyNames(schema).length).toBeGreaterThan(2);
      expect(forbiddenPaths(name, schema)).toEqual([]);
    },
  );

  it("the exempt path exists in orderViewOutput's schema (the exemption is not vacuous)", () => {
    expect(propertyPaths(orderViewOutput)).toContain("session.coperto.vatRate");
    for (const [name, paths] of Object.entries(SCHEMA_SALE_PATHS)) {
      const schema = SCHEMAS[name as keyof typeof SCHEMAS];
      for (const path of paths) expect(propertyPaths(schema)).toContain(path);
    }
    // The only schema with an exemption is the order read; the other five have none.
    expect(Object.keys(SCHEMA_SALE_PATHS)).toEqual(["orderViewOutput"]);
  });

  it("a vatRate or unitCost at any other path of a waiter schema is flagged", () => {
    const sessionWithVat = z.strictObject({
      session: orderViewOutput.shape.session.extend({ vatRate: z.number() }),
      lines: orderViewOutput.shape.lines,
    });
    const lineWithVat = z.strictObject({
      session: orderViewOutput.shape.session,
      lines: z.array(orderLine.extend({ vatRate: z.number() })),
    });
    const sessionWithCost = z.strictObject({
      session: orderViewOutput.shape.session.extend({ unitCost: z.number() }),
      lines: orderViewOutput.shape.lines,
    });
    const copertoWithCost = z.strictObject({
      session: orderViewOutput.shape.session.extend({
        coperto: sessionCoperto.extend({ cost: z.number() }).nullable(),
      }),
      lines: orderViewOutput.shape.lines,
    });
    expect(forbiddenPaths("orderViewOutput", sessionWithVat)).toEqual(["session.vatRate"]);
    expect(forbiddenPaths("orderViewOutput", lineWithVat)).toEqual(["lines.vatRate"]);
    expect(forbiddenPaths("orderViewOutput", sessionWithCost)).toEqual(["session.unitCost"]);
    expect(forbiddenPaths("orderViewOutput", copertoWithCost)).toEqual(["session.coperto.cost"]);
    // The exemption belongs to the order read: the same path on another schema's name is flagged.
    expect(forbiddenPaths("fireOutput", orderViewOutput)).toEqual(["session.coperto.vatRate"]);
  });

  it.each(Object.entries(SCHEMAS))(
    "%s matches the committed JSON Schema (a change is deliberate)",
    (_n, schema) => {
      expect(z.toJSONSchema(schema, { io: "output" })).toMatchSnapshot();
    },
  );
});

describe("orderLine", () => {
  it("has exactly the fifteen keys of the plan (the thirteen of M18 + weightG and pricePer100g, P2-0b)", () => {
    expect(Object.keys(orderLine.shape).sort()).toEqual(
      [
        "clientUpdatedAt",
        "course",
        "id",
        "isShared",
        "menuItemId",
        "name",
        "note",
        "pricePer100g",
        "qty",
        "segue",
        "state",
        "unitPrice",
        "updatedAt",
        "updatedBy",
        "weightG",
      ].sort(),
    );
  });

  it("parses the database shape, with half portions and a note", () => {
    expect(orderLine.parse(LINE_SOUP)).toEqual(LINE_SOUP);
    expect(orderLine.parse(LINE_STEW)).toEqual(LINE_STEW);
  });

  it("parses a weighted line and refuses a cost key on it", () => {
    expect(orderLine.parse(LINE_STEAK)).toEqual(LINE_STEAK);
    expect(orderLine.safeParse({ ...LINE_STEAK, unit_cost: 3 }).success).toBe(false);
    expect(orderLine.safeParse({ ...LINE_STEAK, weightG: 1230.5 }).success).toBe(false);
    expect(orderLine.safeParse({ ...LINE_STEAK, weightG: undefined }).success).toBe(false);
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

  it("has exactly the eleven session keys (the seven of M18 plus openedAt, openedToday, openedBy, coperto: DS-BQ-2)", () => {
    expect(Object.keys(orderViewOutput.shape.session.shape).sort()).toEqual(
      [
        "billRequested",
        "closed",
        "coperto",
        "covers",
        "id",
        "openedAt",
        "openedBy",
        "openedToday",
        "status",
        "tableId",
        "tableName",
      ].sort(),
    );
  });

  it("parses a session with a coperto and one without", () => {
    expect(orderViewOutput.parse(ORDER_VIEW).session.coperto).toEqual({
      perPerson: 2.5,
      vatRate: 10,
      total: 10,
    });
    expect(orderViewOutput.parse(ORDER_VIEW_NO_COPERTO).session.coperto).toBeNull();
  });

  it("refuses an opener with an id, a coperto with an extra key, and a missing openedAt", () => {
    const session = ORDER_VIEW.session;
    const withSession = (patch: object) => ({ ...ORDER_VIEW, session: { ...session, ...patch } });
    expect(
      orderViewOutput.safeParse(
        withSession({ openedBy: { displayName: "Cameriere Demo", id: OIDS.session } }),
      ).success,
    ).toBe(false);
    expect(orderViewOutput.safeParse(withSession({ openedBy: {} })).success).toBe(false);
    expect(
      orderViewOutput.safeParse(withSession({ coperto: { ...session.coperto, cost: 1 } })).success,
    ).toBe(false);
    expect(
      orderViewOutput.safeParse(withSession({ coperto: { perPerson: 2.5, total: 10 } })).success,
    ).toBe(false);
    expect(orderViewOutput.safeParse(withSession({ openedAt: undefined })).success).toBe(false);
    expect(orderViewOutput.safeParse(withSession({ openedToday: undefined })).success).toBe(false);
    expect(orderViewOutput.safeParse(withSession({ coperto: undefined })).success).toBe(false);
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

describe("fireOutput (M19)", () => {
  const reply = {
    lines: [LINE_STEW, LINE_SOUP],
    fired: [LINE_STEW.id],
    skipped: [{ lineId: LINE_SOUP.id, reason: "already_fired" }],
  };

  it("parses the database reply", () => {
    expect(fireOutput.parse(reply)).toEqual(reply);
    expect(fireOutput.safeParse({ lines: [], fired: [], skipped: [] }).success).toBe(true);
  });

  it("knows the two skip reasons", () => {
    expect([...SKIP_REASONS]).toEqual(["already_fired", "voided"]);
    for (const reason of SKIP_REASONS) {
      expect(
        fireOutput.safeParse({ ...reply, skipped: [{ lineId: LINE_SOUP.id, reason }] }).success,
      ).toBe(true);
    }
    expect(
      fireOutput.safeParse({ ...reply, skipped: [{ lineId: LINE_SOUP.id, reason: "stale" }] })
        .success,
    ).toBe(false);
  });

  it("refuses an injected cost, unit price on the reply, or any extra key", () => {
    expect(fireOutput.safeParse({ ...reply, total: 1 }).success).toBe(false);
    expect(
      fireOutput.safeParse({ ...reply, lines: [{ ...LINE_STEW, unit_cost: 2.98 }] }).success,
    ).toBe(false);
    expect(
      fireOutput.safeParse({
        ...reply,
        skipped: [{ lineId: LINE_SOUP.id, reason: "voided", cost: 1 }],
      }).success,
    ).toBe(false);
  });
});
