import { describe, expect, it } from "vitest";
import { opResult } from "@/server/sync/output";
import { toOpResult } from "@/server/sync/results";
import { ADD_REPLY, LINE_STEW, OIDS } from "../../helpers/orders-data";

const OP = "0e000000-0000-4000-8000-000000000001";
const AT = "2026-11-02T19:31:00.123456+00:00";

const fresh = (status: string, result: unknown, stop = false) => ({
  opId: OP,
  status,
  receivedAt: AT,
  stop,
  result,
});
const rejected = (sqlstate: string, message: string, detail: unknown = null, stop = false) =>
  fresh("rejected", { sqlstate, message, detail }, stop);

const SESSION = {
  id: OIDS.session,
  tableId: OIDS.table,
  tableName: "Tavolo 1 (demo)",
  covers: 2,
  openedAt: AT,
  businessDate: "2026-11-02",
  waiter: { id: OIDS.waiterA, displayName: "Cameriere Demo" },
  billRequested: false,
  coperto: null,
};

describe("toOpResult: applied", () => {
  it("wraps an add reply with its kind and receipt time, and parses it strictly", () => {
    const { result, stop } = toOpResult("add_line", fresh("applied", ADD_REPLY));
    expect(stop).toBe(false);
    expect(result).toEqual({
      opId: OP,
      kind: "add_line",
      status: "applied",
      receivedAt: AT,
      reply: ADD_REPLY,
    });
    expect(opResult.safeParse(result).success).toBe(true);
  });

  it("parses each kind with its own output", () => {
    expect(
      toOpResult("open_table", fresh("applied", { created: true, session: SESSION })).result,
    ).toMatchObject({ status: "applied", kind: "open_table" });
    expect(
      toOpResult("edit_line", fresh("applied", { changed: false, line: LINE_STEW })).result,
    ).toMatchObject({ status: "applied", reply: { changed: false } });
    expect(
      toOpResult(
        "fire",
        fresh("applied", {
          lines: [LINE_STEW],
          fired: [LINE_STEW.id],
          skipped: [{ lineId: OIDS.line2, reason: "already_fired" }],
        }),
      ).result,
    ).toMatchObject({ status: "applied", reply: { skipped: [{ reason: "already_fired" }] } });
  });

  it("throws on a reply with an undeclared key (a cost slipping in): the route answers 500", () => {
    const leaky = { ...ADD_REPLY, line: { ...LINE_STEW, unit_cost: 3 } };
    expect(() => toOpResult("add_line", fresh("applied", leaky))).toThrow();
  });
});

describe("toOpResult: conflict", () => {
  it("an edit conflict result becomes a conflict with the server's line", () => {
    const { result, stop } = toOpResult(
      "edit_line",
      fresh("conflict", { conflict: { reason: "fired", line: { ...LINE_STEW, state: "fired" } } }),
    );
    expect(stop).toBe(false);
    expect(result).toMatchObject({
      status: "conflict",
      kind: "edit_line",
      conflict: { reason: "fired", line: { id: LINE_STEW.id, state: "fired" } },
    });
  });

  it("a raised session_closed becomes a conflict without a line, and stops an add", () => {
    const { result, stop } = toOpResult(
      "add_line",
      fresh("conflict", { sqlstate: "P0001", message: "session_closed", detail: null }, true),
    );
    expect(stop).toBe(true);
    expect(result).toEqual({
      opId: OP,
      kind: "add_line",
      status: "conflict",
      receivedAt: AT,
      conflict: { reason: "session_closed" },
    });
  });

  it("a table_already_open conflict carries the open session's id from the stored detail", () => {
    const { result, stop } = toOpResult(
      "open_table",
      fresh(
        "conflict",
        { sqlstate: "P0001", message: "table_already_open", detail: { sessionId: OIDS.session } },
        true,
      ),
    );
    expect(stop).toBe(true);
    expect(result).toMatchObject({
      status: "conflict",
      conflict: { reason: "table_already_open", sessionId: OIDS.session },
    });
  });

  it("a table_already_open detail with an extra key is dropped to the bare conflict", () => {
    const { result } = toOpResult(
      "open_table",
      fresh(
        "conflict",
        {
          sqlstate: "P0001",
          message: "table_already_open",
          detail: { sessionId: OIDS.session, waiter: "Cameriere Demo" },
        },
        true,
      ),
    );
    expect(result).toMatchObject({
      status: "conflict",
      conflict: { reason: "table_already_open" },
    });
    expect(JSON.stringify(result)).not.toContain("Cameriere Demo");
    expect(result).not.toHaveProperty("conflict.sessionId");
  });
});

describe("toOpResult: rejected", () => {
  it("item_unavailable of an add is a 409 with the Italian message and the public detail; it stops the batch", () => {
    const detail = { menuItemId: OIDS.item, reason: "no_portions", portionsLeft: 0 };
    const { result, stop } = toOpResult(
      "add_line",
      rejected("P0001", "item_unavailable", detail, true),
    );
    expect(stop).toBe(true);
    expect(result).toMatchObject({
      status: "rejected",
      kind: "add_line",
      receivedAt: AT,
      error: {
        httpStatus: 409,
        code: "item_unavailable",
        message: "Il piatto è esaurito.",
        details: detail,
      },
    });
  });

  it("line_not_found of a fire is a 404", () => {
    const { result } = toOpResult("fire", rejected("P0002", "line_not_found"));
    expect(result).toMatchObject({
      status: "rejected",
      error: { httpStatus: 404, code: "not_found", message: "Riga non trovata." },
    });
  });

  it("an open_table refusal goes through the tables mapping", () => {
    const { result } = toOpResult("open_table", rejected("P0001", "table_inactive", null, true));
    expect(result).toMatchObject({
      status: "rejected",
      error: { httpStatus: 422, code: "table_inactive" },
    });
  });

  it("22023 is a 400 invalid_request", () => {
    const { result } = toOpResult("edit_line", rejected("22023", "invalid_request"));
    expect(result).toMatchObject({ error: { httpStatus: 400, code: "invalid_request" } });
  });

  it("an unknown P0001 message becomes rejected_unknown, 422, so the queue never blocks on it", () => {
    const { result } = toOpResult("edit_line", rejected("P0001", "brand_new_code"));
    expect(result).toMatchObject({
      status: "rejected",
      error: {
        httpStatus: 422,
        code: "rejected_unknown",
        message: "L'operazione non è stata accettata dal server.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("brand_new_code");
  });

  it("every rejected result is a valid opResult", () => {
    const samples: [Parameters<typeof toOpResult>[0], ReturnType<typeof rejected>][] = [
      ["add_line", rejected("P0002", "menu_item_not_found", null, true)],
      ["void_line", rejected("P0001", "void_reason_invalid")],
      ["add_line", rejected("P0001", "client_time_invalid", null, true)],
    ];
    for (const [kind, raw] of samples) {
      expect(opResult.safeParse(toOpResult(kind, raw).result).success).toBe(true);
    }
  });
});

describe("toOpResult: duplicate", () => {
  it("wraps the stored status and result, and keeps the stop flag", () => {
    const raw = {
      opId: OP,
      status: "duplicate",
      stop: false,
      stored: { status: "applied", receivedAt: AT, result: ADD_REPLY },
    };
    const { result, stop } = toOpResult("add_line", raw);
    expect(stop).toBe(false);
    expect(result).toEqual({
      opId: OP,
      kind: "add_line",
      status: "duplicate",
      stored: { status: "applied", receivedAt: AT, reply: ADD_REPLY },
    });
  });

  it("a duplicate of a rejected add is a rejected stored result and stops the batch", () => {
    const raw = {
      opId: OP,
      status: "duplicate",
      stop: true,
      stored: {
        status: "rejected",
        receivedAt: AT,
        result: { sqlstate: "P0001", message: "item_unavailable", detail: null },
      },
    };
    const { result, stop } = toOpResult("add_line", raw);
    expect(stop).toBe(true);
    expect(result).toMatchObject({
      status: "duplicate",
      stored: { status: "rejected", error: { code: "item_unavailable", httpStatus: 409 } },
    });
  });

  it("a duplicate of a conflict keeps the conflict", () => {
    const raw = {
      opId: OP,
      status: "duplicate",
      stop: false,
      stored: {
        status: "conflict",
        receivedAt: AT,
        result: { conflict: { reason: "voided", line: LINE_STEW } },
      },
    };
    expect(toOpResult("edit_line", raw).result).toMatchObject({
      status: "duplicate",
      stored: { status: "conflict", conflict: { reason: "voided" } },
    });
  });
});

describe("toOpResult: a malformed database reply", () => {
  it("throws rather than guess", () => {
    expect(() => toOpResult("add_line", { status: "applied" })).toThrow();
    expect(() => toOpResult("add_line", null)).toThrow();
  });
});
