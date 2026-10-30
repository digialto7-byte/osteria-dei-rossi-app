import { describe, expect, it } from "vitest";
import { z } from "zod";
import { opResult, syncOutput } from "@/server/sync/output";
import { ADD_REPLY, LINE_STEW, OIDS } from "../../helpers/orders-data";

const OP = "0e000000-0000-4000-8000-000000000001";
const AT = "2026-11-02T19:31:00.123456+00:00";

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

describe("syncOutput", () => {
  it("its JSON Schema is the one the phone relies on (snapshot)", () => {
    expect(z.toJSONSchema(syncOutput, { io: "output" })).toMatchSnapshot();
  });

  it("has no cost, margin, GP, food or recipe key at any depth, and no VAT key but the coperto's rate", () => {
    const names = propertyNames(syncOutput);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => /cost|margin|gp|food|eur$|recipe/i.test(n))).toEqual([]);
    // open_table's session carries the coperto (a sale charge the waiter already sees since M17): its rate is the one VAT key.
    expect([...new Set(names.filter((n) => /vat/i.test(n)))]).toEqual(["vatRate"]);
  });

  it("accepts an applied add", () => {
    const ok = opResult.safeParse({
      opId: OP,
      kind: "add_line",
      status: "applied",
      receivedAt: AT,
      reply: ADD_REPLY,
    });
    expect(ok.success).toBe(true);
  });

  it("fails the strict parse when a cost key slips into an applied reply", () => {
    const leaky = {
      opId: OP,
      kind: "add_line",
      status: "applied",
      receivedAt: AT,
      reply: { ...ADD_REPLY, line: { ...LINE_STEW, unit_cost: 3.2 } },
    };
    expect(opResult.safeParse(leaky).success).toBe(false);
  });

  it("fails the strict parse when a cost key sits beside the reply", () => {
    const leaky = {
      opId: OP,
      kind: "add_line",
      status: "applied",
      receivedAt: AT,
      reply: ADD_REPLY,
      total_cost: 3,
    };
    expect(opResult.safeParse(leaky).success).toBe(false);
  });

  it("accepts a rejected op that was never sent to the database (receivedAt null)", () => {
    const ok = opResult.safeParse({
      opId: OP,
      kind: "add_line",
      status: "rejected",
      receivedAt: null,
      error: { httpStatus: 400, code: "invalid_request", message: "Richiesta non valida." },
    });
    expect(ok.success).toBe(true);
  });

  it("accepts a conflict with the server's line, and a table_already_open with the session id", () => {
    expect(
      opResult.safeParse({
        opId: OP,
        kind: "edit_line",
        status: "conflict",
        receivedAt: AT,
        conflict: { reason: "fired", line: LINE_STEW },
      }).success,
    ).toBe(true);
    expect(
      opResult.safeParse({
        opId: OP,
        kind: "open_table",
        status: "conflict",
        receivedAt: AT,
        conflict: { reason: "table_already_open", sessionId: OIDS.session },
      }).success,
    ).toBe(true);
  });

  it("refuses a conflict reason it does not know", () => {
    expect(
      opResult.safeParse({
        opId: OP,
        kind: "edit_line",
        status: "conflict",
        receivedAt: AT,
        conflict: { reason: "because" },
      }).success,
    ).toBe(false);
  });

  it("accepts a duplicate wrapping a stored result, which carries no op id of its own", () => {
    const stored = { status: "applied", receivedAt: AT, reply: ADD_REPLY };
    expect(
      opResult.safeParse({ opId: OP, kind: "add_line", status: "duplicate", stored }).success,
    ).toBe(true);
    expect(
      opResult.safeParse({
        opId: OP,
        kind: "add_line",
        status: "duplicate",
        stored: { ...stored, opId: OP },
      }).success,
    ).toBe(false);
  });

  it("a stopped batch names the op and one of the three reasons", () => {
    const base = { results: [], serverTime: AT };
    for (const reason of ["dead_entity", "unavailable", "user_mismatch"]) {
      expect(syncOutput.safeParse({ ...base, stopped: { opId: OP, reason } }).success).toBe(true);
    }
    expect(syncOutput.safeParse({ ...base, stopped: null }).success).toBe(true);
    expect(syncOutput.safeParse({ ...base, stopped: { opId: OP, reason: "tired" } }).success).toBe(
      false,
    );
  });
});
