import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  copertoChangeOutput,
  copertoReadOutput,
  createDiningTableOutput,
  diningTablesOutput,
  openTableOutput,
  sessionOutput,
  sessionResponse,
  tablesListOutput,
  updateDiningTableOutput,
} from "@/server/tables/output";

const T1 = "7a000000-0000-4000-8000-000000000001";
const S1 = "5e000000-0000-4000-8000-000000000001";
const W1 = "a0000000-0000-4000-8000-000000000001";

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
const WAITER_FORBIDDEN = /cost|margin|gp|food|eur$|recipe/i;

const COPERTO = { perPerson: 1.5, vatRate: 10, total: 6 };
const SESSION = {
  id: S1,
  tableId: T1,
  tableName: "Tavolo 1 (demo)",
  covers: 4,
  openedAt: "2026-11-02T19:15:00.123456+00:00",
  businessDate: "2026-11-02",
  waiter: { id: W1, displayName: "Cameriere Demo" },
  billRequested: false,
  coperto: COPERTO,
};
const TILE_SESSION = {
  id: S1,
  covers: 4,
  openedAt: "2026-11-02T19:15:00+00:00",
  openedToday: true,
  waiter: { id: W1, displayName: "Cameriere Demo" },
  billRequested: false,
  coperto: COPERTO,
};
const LIST = {
  businessDate: "2026-11-02",
  tables: [
    { id: T1, name: "Tavolo 1 (demo)", position: 1, status: "open", session: TILE_SESSION },
    { id: S1, name: "Tavolo 2 (demo)", position: 2, status: "free", session: null },
  ],
};

describe("tablesListOutput", () => {
  it("parses a list with an open and a free table", () => {
    expect(tablesListOutput.parse(LIST)).toEqual(LIST);
  });

  it("accepts every status of the derivation and a null coperto", () => {
    for (const status of ["free", "open", "courses_sent", "bill_requested", "closed"]) {
      const table = { ...LIST.tables[1]!, status };
      expect(tablesListOutput.safeParse({ ...LIST, tables: [table] }).success, status).toBe(true);
    }
    const noCoperto = { ...LIST.tables[0]!, session: { ...TILE_SESSION, coperto: null } };
    expect(tablesListOutput.safeParse({ ...LIST, tables: [noCoperto] }).success).toBe(true);
  });

  it.each([
    ["a status that does not exist", { status: "paid" }],
    ["a cost key", { unit_cost: 3 }],
    ["a margin key", { margin_eur: 9 }],
  ])("refuses %s on a table", (_name, extra) => {
    expect(
      tablesListOutput.safeParse({ ...LIST, tables: [{ ...LIST.tables[0]!, ...extra }] }).success,
    ).toBe(false);
  });

  it("refuses a stray key inside the session and inside the coperto", () => {
    const stray = { ...LIST.tables[0]!, session: { ...TILE_SESSION, recipeKey: S1 } };
    expect(tablesListOutput.safeParse({ ...LIST, tables: [stray] }).success).toBe(false);
    const coperto = {
      ...LIST.tables[0]!,
      session: { ...TILE_SESSION, coperto: { ...COPERTO, cost: 1 } },
    };
    expect(tablesListOutput.safeParse({ ...LIST, tables: [coperto] }).success).toBe(false);
  });

  it("matches the committed JSON Schema", () => {
    expect(z.toJSONSchema(tablesListOutput, { io: "output" })).toMatchSnapshot();
  });
});

describe("session shapes", () => {
  it("openTableOutput: created and the session", () => {
    expect(openTableOutput.parse({ created: true, session: SESSION })).toEqual({
      created: true,
      session: SESSION,
    });
    expect(
      openTableOutput.safeParse({ created: true, session: { ...SESSION, coperto: null } }).success,
    ).toBe(true);
    expect(openTableOutput.safeParse({ session: SESSION }).success).toBe(false);
  });

  it("sessionOutput is the session without a status; sessionResponse adds it", () => {
    expect(sessionOutput.parse(SESSION)).toEqual(SESSION);
    expect(sessionOutput.safeParse({ ...SESSION, status: "open" }).success).toBe(false);
    const withStatus = { session: { ...SESSION, status: "bill_requested" } };
    expect(sessionResponse.parse(withStatus)).toEqual(withStatus);
    expect(sessionResponse.safeParse({ session: SESSION }).success).toBe(false);
  });

  it("refuses a cost key in the session", () => {
    expect(sessionOutput.safeParse({ ...SESSION, food_cost: 2 }).success).toBe(false);
    expect(
      openTableOutput.safeParse({ created: true, session: { ...SESSION, margin_eur: 2 } }).success,
    ).toBe(false);
  });

  it("matches the committed JSON Schemas", () => {
    expect(z.toJSONSchema(openTableOutput, { io: "output" })).toMatchSnapshot("open");
    expect(z.toJSONSchema(sessionResponse, { io: "output" })).toMatchSnapshot("session");
    expect(z.toJSONSchema(sessionOutput, { io: "output" })).toMatchSnapshot("base");
  });
});

describe("the waiter shapes carry no cost, margin, GP, food cost or recipe key (AT4)", () => {
  it.each([
    ["tablesListOutput", tablesListOutput],
    ["openTableOutput", openTableOutput],
    ["sessionResponse", sessionResponse],
    ["sessionOutput", sessionOutput],
  ])("%s", (_name, schema) => {
    const names = propertyNames(schema);
    expect(names.length).toBeGreaterThan(8);
    expect(names.filter((name) => WAITER_FORBIDDEN.test(name))).toEqual([]);
  });
});

describe("owner and admin shapes", () => {
  const TABLE = { id: T1, name: "Tavolo 1 (demo)", position: 1, active: true, open: false };

  it("dining tables: list, create, update", () => {
    expect(diningTablesOutput.parse({ tables: [TABLE] })).toEqual({ tables: [TABLE] });
    expect(createDiningTableOutput.parse({ table: TABLE })).toEqual({ table: TABLE });
    expect(updateDiningTableOutput.parse({ changed: true, table: TABLE })).toEqual({
      changed: true,
      table: TABLE,
    });
    expect(diningTablesOutput.safeParse({ tables: [{ ...TABLE, extra: 1 }] }).success).toBe(false);
  });

  it("coperto settings: set and unset", () => {
    const set = {
      coperto: { amount: 1.5, vatRate: 10 },
      defaults: { vatRate: 10 },
      vatRates: [0, 4, 5, 10, 22],
    };
    expect(copertoReadOutput.parse(set)).toEqual(set);
    const unset = { ...set, coperto: null, defaults: { vatRate: null } };
    expect(copertoReadOutput.parse(unset)).toEqual(unset);
    expect(
      copertoChangeOutput.parse({ changed: true, coperto: { amount: 2, vatRate: 22 } }),
    ).toEqual({
      changed: true,
      coperto: { amount: 2, vatRate: 22 },
    });
    expect(copertoChangeOutput.parse({ changed: false, coperto: null }).coperto).toBeNull();
    expect(copertoChangeOutput.safeParse({ changed: true }).success).toBe(false);
  });
});
