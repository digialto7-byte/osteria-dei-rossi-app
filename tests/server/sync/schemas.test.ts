import { describe, expect, it } from "vitest";
import { PAYLOADS, opEnvelope, syncBody } from "@/server/sync/schemas";
import { MAX_SYNC_OPS, SYNC_KINDS } from "@/server/sync/constants";

const OP = (n: number) => `0e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = "a0000000-0000-4000-8000-000000000001";
const SESSION = "5e000000-0000-4000-8000-000000000001";
const LINE = "10000000-0000-4000-8000-000000000001";
const ITEM = "3e000000-0000-4000-8000-000000000001";
const TABLE = "7a000000-0000-4000-8000-000000000001";
const AT = "2026-11-02T19:30:00.123Z";

const PAYLOAD_OF: Record<(typeof SYNC_KINDS)[number], object> = {
  open_table: { tableId: TABLE, sessionId: SESSION, covers: 2 },
  add_line: { sessionId: SESSION, lineId: LINE, menuItemId: ITEM },
  edit_line: { lineId: LINE, qty: 2 },
  remove_line: { lineId: LINE },
  fire: { sessionId: SESSION, lineIds: [LINE] },
  void_line: { lineId: LINE, reason: "order_error" },
};

const op = (n: number, extra: object = {}) => ({
  opId: OP(n),
  seq: n,
  kind: "add_line",
  clientTs: AT,
  userId: USER,
  payload: PAYLOAD_OF.add_line,
  ...extra,
});

describe("opEnvelope", () => {
  it.each(SYNC_KINDS)("accepts the kind %s", (kind) => {
    expect(opEnvelope.safeParse(op(1, { kind, payload: PAYLOAD_OF[kind] })).success).toBe(true);
  });

  it.each([
    ["an unknown kind", { kind: "close_table" }],
    ["seq 0", { seq: 0 }],
    ["a fractional seq", { seq: 1.5 }],
    ["a malformed opId", { opId: "x" }],
    ["a malformed userId", { userId: "x" }],
    ["a clientTs without an offset", { clientTs: "2026-11-02T19:30:00" }],
    ["a clientTs in words", { clientTs: "yesterday" }],
    ["an extra key", { extra: 1 }],
    ["a payload that is not an object", { payload: [] }],
  ])("refuses %s", (_name, extra) => {
    expect(opEnvelope.safeParse(op(1, extra)).success).toBe(false);
  });
});

describe("syncBody", () => {
  it("accepts one op and twenty", () => {
    expect(syncBody.safeParse({ ops: [op(1)] }).success).toBe(true);
    const twenty = Array.from({ length: MAX_SYNC_OPS }, (_v, i) => op(i + 1));
    expect(syncBody.safeParse({ ops: twenty }).success).toBe(true);
  });

  it("refuses no ops and twenty-one", () => {
    expect(syncBody.safeParse({ ops: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_SYNC_OPS + 1 }, (_v, i) => op(i + 1));
    expect(syncBody.safeParse({ ops: many }).success).toBe(false);
  });

  it("refuses a duplicate opId", () => {
    expect(syncBody.safeParse({ ops: [op(1), op(2, { opId: OP(1) })] }).success).toBe(false);
  });

  it.each([
    ["equal", [1, 1]],
    ["descending", [2, 1]],
  ])("refuses seq that is not strictly increasing (%s)", (_name, seqs) => {
    const ops = seqs.map((seq, i) => op(i + 1, { seq }));
    expect(syncBody.safeParse({ ops }).success).toBe(false);
  });

  it("accepts gaps in seq (settled ops leave holes)", () => {
    expect(syncBody.safeParse({ ops: [op(1, { seq: 3 }), op(2, { seq: 9 })] }).success).toBe(true);
  });

  it("refuses an extra key and a missing ops", () => {
    expect(syncBody.safeParse({ ops: [op(1)], extra: 1 }).success).toBe(false);
    expect(syncBody.safeParse({}).success).toBe(false);
  });
});

describe("PAYLOADS", () => {
  it.each(SYNC_KINDS)("%s accepts its own payload", (kind) => {
    expect(PAYLOADS[kind].safeParse(PAYLOAD_OF[kind]).success).toBe(true);
  });

  it.each(SYNC_KINDS)("%s refuses an unknown key", (kind) => {
    expect(PAYLOADS[kind].safeParse({ ...PAYLOAD_OF[kind], unitPrice: 1 }).success).toBe(false);
  });

  it.each(["add_line", "edit_line", "remove_line", "void_line"] as const)(
    "%s refuses clientUpdatedAt in the payload (the stamp is the op's clientTs)",
    (kind) => {
      expect(PAYLOADS[kind].safeParse({ ...PAYLOAD_OF[kind], clientUpdatedAt: AT }).success).toBe(
        false,
      );
    },
  );

  it("fire refuses 51 ids, none, and a repeated id", () => {
    const ids = Array.from({ length: 51 }, (_v, i) => OP(i + 1));
    expect(PAYLOADS.fire.safeParse({ sessionId: SESSION, lineIds: ids }).success).toBe(false);
    expect(PAYLOADS.fire.safeParse({ sessionId: SESSION, lineIds: ids.slice(0, 50) }).success).toBe(
      true,
    );
    expect(PAYLOADS.fire.safeParse({ sessionId: SESSION, lineIds: [] }).success).toBe(false);
    expect(PAYLOADS.fire.safeParse({ sessionId: SESSION, lineIds: [LINE, LINE] }).success).toBe(
      false,
    );
  });

  it("void_line refuses entry_removed (the internal reason) and accepts the six others", () => {
    expect(PAYLOADS.void_line.safeParse({ lineId: LINE, reason: "entry_removed" }).success).toBe(
      false,
    );
    for (const reason of [
      "order_error",
      "customer_changed",
      "kitchen_error",
      "returned",
      "comp",
      "breakage",
    ]) {
      expect(PAYLOADS.void_line.safeParse({ lineId: LINE, reason }).success).toBe(true);
    }
  });

  it("edit_line needs at least one field to change", () => {
    expect(PAYLOADS.edit_line.safeParse({ lineId: LINE }).success).toBe(false);
    expect(PAYLOADS.edit_line.safeParse({ lineId: LINE, note: null }).success).toBe(true);
    expect(PAYLOADS.edit_line.safeParse({ lineId: LINE, qty: 0.3 }).success).toBe(false);
  });

  it("open_table checks covers 1 to 99", () => {
    expect(
      PAYLOADS.open_table.safeParse({ tableId: TABLE, sessionId: SESSION, covers: 0 }).success,
    ).toBe(false);
    expect(
      PAYLOADS.open_table.safeParse({ tableId: TABLE, sessionId: SESSION, covers: 99 }).success,
    ).toBe(true);
    expect(
      PAYLOADS.open_table.safeParse({ tableId: TABLE, sessionId: SESSION, covers: 100 }).success,
    ).toBe(false);
  });

  it("add_line refuses a missing sessionId", () => {
    expect(PAYLOADS.add_line.safeParse({ lineId: LINE, menuItemId: ITEM }).success).toBe(false);
  });
});
