import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { IDS, SESSION } from "../../helpers/menu-tables-data";
import {
  ACTION_RESULT,
  GROUP_1,
  RESERVATION_1,
  SEATABLE_DETAIL,
  SEATED_DETAIL,
  SESSION_1,
  TABLE_1,
  TABLE_2,
  WAITER_ACTION_RESULT,
} from "../../helpers/reservations-data";
import { isMessageKey } from "@/lib/i18n";
import { REQUEST_INVALID_REASONS, SLOT_UNAVAILABLE_REASONS } from "@/server/reservations/constants";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const create = await import("@/app/api/reservations/route");
const accept = await import("@/app/api/reservations/[id]/accept/route");
const decline = await import("@/app/api/reservations/[id]/decline/route");
const move = await import("@/app/api/reservations/[id]/move/route");
const tables = await import("@/app/api/reservations/[id]/tables/route");
const mark = await import("@/app/api/reservations/[id]/mark/route");
const seat = await import("@/app/api/reservations/[id]/seat/route");
const erase = await import("@/app/api/reservations/[id]/erase-contact/route");
const split = await import("@/app/api/reservations/[id]/split/route");

const BASE = "http://localhost:3000/api/reservations";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details: details ?? null },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  const result = role === "waiter" ? WAITER_ACTION_RESULT : ACTION_RESULT;
  const created = { ...result, status: "accepted", source: "staff", changed: true };
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: {
      accept_reservation: [ok(result)],
      decline_reservation: [ok(result)],
      move_reservation: [ok(result)],
      assign_reservation_tables: [ok(result)],
      mark_reservation: [ok(result)],
      erase_reservation_contact: [ok(result)],
      split_reservation_tables: [ok(result)],
      create_staff_reservation: [ok(created)],
      ...rpc,
    },
  });
}
type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
const call = (
  handler: Handler,
  path: string,
  body: unknown,
  id: string | null = RESERVATION_1,
  init: RequestInit = {},
) =>
  handler(
    jsonRequest(`${BASE}${path}`, body, init),
    id === null ? undefined : routeContext({ id }),
  );
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string; details?: unknown } })
    .error;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

const PICK = { tableIds: [TABLE_1, TABLE_2], groupId: GROUP_1 };
const NO_TABLE = { tableIds: null, groupId: null };
const MOVE = { date: "2026-11-21", time: "20:15", serviceKey: "cena", party: 5 };

// Every route: [name, handler, path, body, the RPC, its expected arguments].
const MANAGER_ROUTES = [
  [
    "accept",
    accept.POST,
    "/x/accept",
    PICK,
    "accept_reservation",
    { p_id: RESERVATION_1, p_body: PICK },
  ],
  [
    "decline",
    decline.POST,
    "/x/decline",
    { reason: "full" },
    "decline_reservation",
    { p_id: RESERVATION_1, p_body: { reason: "full" } },
  ],
  ["move", move.POST, "/x/move", MOVE, "move_reservation", { p_id: RESERVATION_1, p_body: MOVE }],
  [
    "tables",
    tables.POST,
    "/x/tables",
    PICK,
    "assign_reservation_tables",
    { p_id: RESERVATION_1, p_body: PICK },
  ],
  [
    "erase-contact",
    erase.POST,
    "/x/erase-contact",
    {},
    "erase_reservation_contact",
    { p_id: RESERVATION_1 },
  ],
] as const;

describe.each(MANAGER_ROUTES)(
  "POST /api/reservations/:id/%s",
  (_name, handler, path, body, rpc, args) => {
    it.each(["owner", "admin"])("%s: 200 and one RPC with the exact arguments", async (role) => {
      as(role);
      const response = await call(handler as Handler, path, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(ACTION_RESULT);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith(rpc, args);
    });

    it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
      as(role);
      expect((await call(handler as Handler, path, body)).status).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it("no session is 401", async () => {
      as("none");
      expect((await call(handler as Handler, path, body)).status).toBe(401);
    });

    it("a malformed id is 404 without an RPC", async () => {
      expect((await call(handler as Handler, path, body, "nope")).status).toBe(404);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it("text/plain is 415 and an extra key is 400, with no RPC", async () => {
      expect(
        (
          await call(handler as Handler, path, "x", RESERVATION_1, {
            headers: { "content-type": "text/plain" },
          })
        ).status,
      ).toBe(415);
      expect(
        (await call(handler as Handler, path, { ...(body as object), note: "x" })).status,
      ).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it("a reply with a money key is a 500 that leaks nothing", async () => {
      as("owner", { [rpc]: [ok({ ...ACTION_RESULT, totalEur: 1, name: "Cliente Demo" })] });
      const response = await call(handler as Handler, path, body);
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("Cliente");
    });
  },
);

describe("the table picks", () => {
  it.each([
    ["accept", accept.POST, "/x/accept"],
    ["tables", tables.POST, "/x/tables"],
  ] as const)(
    "%s: both keys are required, nine tables and bad ids are 400",
    async (_n, handler, path) => {
      for (const body of [
        {},
        { tableIds: [TABLE_1] },
        { groupId: null },
        { tableIds: Array.from({ length: 9 }, () => TABLE_1), groupId: null },
        { tableIds: ["x"], groupId: null },
        { tableIds: null, groupId: "x" },
      ]) {
        expect((await call(handler as Handler, path, body)).status).toBe(400);
      }
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("accept: Senza tavolo sends tableIds null and groupId null as given", async () => {
    await call(accept.POST as Handler, "/x/accept", NO_TABLE);
    expect(client.rpc).toHaveBeenCalledWith("accept_reservation", {
      p_id: RESERVATION_1,
      p_body: NO_TABLE,
    });
  });
});

describe("decline, move and mark bodies", () => {
  it.each([{ reason: "busy" }, {}, { reason: "full", x: 1 }])("decline %j is 400", async (body) => {
    expect((await call(decline.POST as Handler, "/x/decline", body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["full", "closed", "other"])("decline reason %s passes", async (reason) => {
    expect((await call(decline.POST as Handler, "/x/decline", { reason })).status).toBe(200);
  });

  it.each([
    ["a bad date", { ...MOVE, date: "2026-02-30" }],
    ["a time of 9:00", { ...MOVE, time: "9:00" }],
    ["a time of 24:00", { ...MOVE, time: "24:00" }],
    ["party 0", { ...MOVE, party: 0 }],
    ["party 100", { ...MOVE, party: 100 }],
    ["a service key in capitals", { ...MOVE, serviceKey: "Cena" }],
    ["a missing key", { date: MOVE.date, time: MOVE.time, party: 2 }],
  ])("move with %s is 400 without an RPC", async (_label, body) => {
    expect((await call(move.POST as Handler, "/x/move", body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("move: party 99 and 1 pass (staff may go above the online maximum)", async () => {
    expect((await call(move.POST as Handler, "/x/move", { ...MOVE, party: 99 })).status).toBe(200);
    expect((await call(move.POST as Handler, "/x/move", { ...MOVE, party: 1 })).status).toBe(200);
  });
});

describe("POST /api/reservations/:id/mark", () => {
  it.each(["owner", "admin", "waiter"])("%s: 200 and one RPC", async (role) => {
    as(role);
    const response = await call(mark.POST as Handler, "/x/mark", { mark: "arrived" });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("mark_reservation", {
      p_id: RESERVATION_1,
      p_body: { mark: "arrived" },
    });
  });

  it("the waiter's reply is parsed by the waiter schema (no emailStatus)", async () => {
    as("waiter");
    const body = await (await call(mark.POST as Handler, "/x/mark", { mark: "no_show" })).json();
    expect(body).toEqual(WAITER_ACTION_RESULT);
    expect(body).not.toHaveProperty("emailStatus");
  });

  it("a waiter reply that carries emailStatus is a 500", async () => {
    as("waiter", { mark_reservation: [ok(ACTION_RESULT)] });
    expect((await call(mark.POST as Handler, "/x/mark", { mark: "arrived" })).status).toBe(500);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await call(mark.POST as Handler, "/x/mark", { mark: "arrived" })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([{ mark: "seated" }, {}, { mark: "arrived", x: 1 }])("%j is 400", async (body) => {
    expect((await call(mark.POST as Handler, "/x/mark", body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/reservations (a booking typed by staff)", () => {
  const BODY = {
    date: "2026-11-20",
    time: "13:05",
    serviceKey: "pranzo",
    party: 12,
    name: "Cliente Demo",
    phone: "+39 000 0000001",
  };

  it.each(["owner", "admin", "waiter"])(
    "%s: 201 and one RPC with exactly { p_body }",
    async (role) => {
      as(role);
      const response = await call(create.POST as Handler, "", BODY, null);
      expect(response.status).toBe(201);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("create_staff_reservation", { p_body: BODY });
    },
  );

  it("the chef gets 403 with 0 RPCs", async () => {
    as("chef");
    expect((await call(create.POST as Handler, "", BODY, null)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await call(create.POST as Handler, "", BODY, null)).status).toBe(401);
  });

  it("the optional keys pass: e-mail, locale, tables, group", async () => {
    const full = {
      ...BODY,
      email: "cliente.demo@example.com",
      locale: "en",
      tableIds: [TABLE_1],
      groupId: null,
    };
    expect((await call(create.POST as Handler, "", full, null)).status).toBe(201);
    expect(client.rpc).toHaveBeenCalledWith("create_staff_reservation", { p_body: full });
  });

  it.each([
    ["a note (no free text, Q-R13)", { ...BODY, note: "allergia" }],
    ["no name", { ...BODY, name: undefined }],
    ["a blank name", { ...BODY, name: "  " }],
    ["an 81-character name", { ...BODY, name: "x".repeat(81) }],
    ["no phone", { ...BODY, phone: undefined }],
    ["a phone with letters", { ...BODY, phone: "abc123" }],
    ["a 5-digit phone", { ...BODY, phone: "12345" }],
    ["no date", { ...BODY, date: undefined }],
    ["a bad date", { ...BODY, date: "2026-13-01" }],
    ["a bad time", { ...BODY, time: "9:00" }],
    ["no party", { ...BODY, party: undefined }],
    ["party 0", { ...BODY, party: 0 }],
    ["party 100", { ...BODY, party: 100 }],
    ["an e-mail without @", { ...BODY, email: "x" }],
    ["a locale of fr", { ...BODY, locale: "fr" }],
    ["a privacy flag (staff bookings have none)", { ...BODY, privacyAck: true }],
    ["a source key", { ...BODY, source: "online" }],
  ])("%s is 400 without an RPC", async (_label, body) => {
    expect((await call(create.POST as Handler, "", body, null)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("party 99 and an empty e-mail (null) pass", async () => {
    expect(
      (await call(create.POST as Handler, "", { ...BODY, party: 99, email: null }, null)).status,
    ).toBe(201);
  });

  it.each([
    ["date_past", "422", "date_past"],
    ["service", "422", "service_invalid"],
    ["table_taken", "409", "table_taken"],
  ])("P0001 %s is %s %s", async (message, status, code) => {
    as("waiter", { create_staff_reservation: [failure("P0001", message)] });
    const response = await call(create.POST as Handler, "", BODY, null);
    expect(response.status).toBe(Number(status));
    expect((await errorOf(response)).code).toBe(code);
  });

  it("P0002 table_not_found is 404", async () => {
    as("waiter", { create_staff_reservation: [failure("P0002", "table_not_found")] });
    expect((await call(create.POST as Handler, "", BODY, null)).status).toBe(404);
  });

  it("the waiter's reply has no emailStatus", async () => {
    as("waiter");
    expect(await (await call(create.POST as Handler, "", BODY, null)).json()).not.toHaveProperty(
      "emailStatus",
    );
  });

  it("a reply that echoes the customer in a log is not possible: a bad reply reports codes only", async () => {
    as("waiter", {
      create_staff_reservation: [ok({ ...WAITER_ACTION_RESULT, party: "Cliente Demo" })],
    });
    expect((await call(create.POST as Handler, "", BODY, null)).status).toBe(500);
    expect(String((reportError.mock.calls[0]![0] as Error).message)).not.toContain("Cliente");
  });
});

describe("POST /api/reservations/:id/split", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s: 200 and one RPC (all non-lead tables when none are named)",
    async (role) => {
      as(role);
      const response = await call(split.POST as Handler, "/x/split", {});
      expect(response.status).toBe(200);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("split_reservation_tables", {
        p_reservation: RESERVATION_1,
        p_tables: null,
      });
    },
  );

  it("named tables are passed through", async () => {
    await call(split.POST as Handler, "/x/split", { tableIds: [TABLE_2] });
    expect(client.rpc).toHaveBeenCalledWith("split_reservation_tables", {
      p_reservation: RESERVATION_1,
      p_tables: [TABLE_2],
    });
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await call(split.POST as Handler, "/x/split", {})).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { tableIds: [] },
    { tableIds: ["x"] },
    { tables: [TABLE_2] },
    { tableIds: Array.from({ length: 9 }, () => TABLE_2) },
  ])("%j is 400", async (body) => {
    expect((await call(split.POST as Handler, "/x/split", body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["lead_table", 409],
    ["status_invalid", 409],
    ["table_not_assigned", 409],
  ])("P0001 %s is %i", async (message, status) => {
    as("waiter", { split_reservation_tables: [failure("P0001", message)] });
    expect((await call(split.POST as Handler, "/x/split", {})).status).toBe(status);
  });
});

describe("error mapping of the actions", () => {
  it.each([
    ["status_invalid", 409],
    ["table_taken", 409],
    ["reservation_expired", 409],
    ["too_early", 409],
    ["table_not_assigned", 409],
    ["group_mismatch", 422],
  ])("P0001 %s is %i with an Italian sentence", async (message, status) => {
    as("owner", { accept_reservation: [failure("P0001", message)] });
    const response = await call(accept.POST as Handler, "/x/accept", PICK);
    expect(response.status).toBe(status);
    const error = await errorOf(response);
    expect(error.code).toBe(message);
    expect(error.message.length).toBeGreaterThan(5);
    expect(isMessageKey(`reservationError.${message}`)).toBe(true);
  });

  it.each(SLOT_UNAVAILABLE_REASONS)(
    "slot_unavailable (%s) is 422 with the reason and a text",
    async (reason) => {
      as("owner", {
        move_reservation: [failure("P0001", "slot_unavailable", JSON.stringify({ reason }))],
      });
      const response = await call(move.POST as Handler, "/x/move", MOVE);
      expect(response.status).toBe(422);
      const error = await errorOf(response);
      expect(error.code).toBe("slot_unavailable");
      expect(error.details).toEqual({ reason });
      expect(isMessageKey(`reservationError.slot.${reason}`)).toBe(true);
    },
  );

  it.each(REQUEST_INVALID_REASONS)(
    "request_invalid (%s) is 422 reservation_invalid with the reason",
    async (reason) => {
      as("waiter", {
        create_staff_reservation: [failure("P0001", "request_invalid", JSON.stringify({ reason }))],
      });
      const response = await call(
        create.POST as Handler,
        "",
        {
          date: "2026-11-20",
          time: "20:00",
          serviceKey: "cena",
          party: 2,
          name: "Cliente Demo",
          phone: "390000000001",
        },
        null,
      );
      expect(response.status).toBe(422);
      const error = await errorOf(response);
      expect(error.code).toBe("reservation_invalid");
      expect(error.details).toEqual({ reason });
      expect(isMessageKey(`reservationError.field.${reason}`)).toBe(true);
    },
  );

  it("a reason that is not a known code is not echoed", async () => {
    as("owner", {
      move_reservation: [failure("P0001", "slot_unavailable", '{"reason": "Cliente Demo"}')],
    });
    const response = await call(move.POST as Handler, "/x/move", MOVE);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Cliente");
  });

  it("P0002 reservation_not_found is 404; 22023 is 400; XX000 is a 500", async () => {
    as("owner", { accept_reservation: [failure("P0002", "reservation_not_found")] });
    expect((await call(accept.POST as Handler, "/x/accept", PICK)).status).toBe(404);
    as("owner", { accept_reservation: [failure("22023", "invalid_request")] });
    expect((await call(accept.POST as Handler, "/x/accept", PICK)).status).toBe(400);
    as("owner", { accept_reservation: [failure("XX000", "secret internals")] });
    const response = await call(accept.POST as Handler, "/x/accept", PICK);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("P0002 table_not_found on a pick is 404 with the table text", async () => {
    as("owner", { accept_reservation: [failure("P0002", "table_not_found")] });
    const response = await call(accept.POST as Handler, "/x/accept", PICK);
    expect(response.status).toBe(404);
    expect((await errorOf(response)).message).toBe("Tavolo non trovato.");
  });
});

describe("POST /api/reservations/:id/seat", () => {
  const BODY = { sessionId: SESSION_1, covers: 6 };
  const OPEN = { created: true, session: { ...SESSION, id: SESSION_1, tableId: TABLE_1 } };
  // The waiter's replies have no emailStatus key.
  const forRole = (role: string, reply: Record<string, unknown>) => {
    if (role !== "waiter") return reply;
    const { emailStatus: _hidden, ...rest } = reply;
    return rest;
  };
  const SEATED = { ...ACTION_RESULT, status: "seated", sessionId: SESSION_1 };

  function asSeat(role: string, rpc: Record<string, Record<string, unknown> | FakeResult> = {}) {
    const wrap = (value: Record<string, unknown> | FakeResult) =>
      "error" in value && "data" in value
        ? (value as FakeResult)
        : ok(forRole(role, value as Record<string, unknown>));
    const defaults: Record<string, Record<string, unknown> | FakeResult> = {
      reservation_detail: SEATABLE_DETAIL,
      seat_reservation: SEATED,
      open_table: ok(OPEN),
    };
    const merged = { ...defaults, ...rpc };
    client = fakeSupabase({
      claims: claimsFor(role),
      rpc: Object.fromEntries(
        Object.entries(merged).map(([name, value]) => [
          name,
          [name === "open_table" ? (value as FakeResult) : wrap(value)],
        ]),
      ),
    });
  }
  const run = (body: unknown = BODY, id: string = RESERVATION_1) =>
    seat.POST(jsonRequest(`${BASE}/${id}/seat`, body), routeContext({ id }));
  const names = () => client.rpc.mock.calls.map((c: unknown[]) => c[0]);

  it.each(["owner", "admin", "waiter"])(
    "%s: 200, and the RPCs run detail, open_table, seat_reservation in that order",
    async (role) => {
      asSeat(role);
      const response = await run();
      expect(response.status).toBe(200);
      expect(names()).toEqual(["reservation_detail", "open_table", "seat_reservation"]);
    },
  );

  it("opens the lead table with the client's session id and the covers, then seats", async () => {
    asSeat("owner");
    const response = await run();
    expect(await response.json()).toEqual({ sessionId: SESSION_1, created: true });
    expect(client.rpc).toHaveBeenCalledWith("open_table", {
      p_table: TABLE_1,
      p_session: SESSION_1,
      p_covers: 6,
    });
    expect(client.rpc).toHaveBeenCalledWith("seat_reservation", {
      p_id: RESERVATION_1,
      p_session: SESSION_1,
    });
  });

  it("the chef gets 403 before any RPC", async () => {
    asSeat("chef");
    expect((await run()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { sessionId: "x", covers: 2 },
    { sessionId: SESSION_1, covers: 0 },
    { sessionId: SESSION_1, covers: 100 },
    { sessionId: SESSION_1 },
    { ...BODY, x: 1 },
    { ...BODY, tableId: "x" },
  ])("%j is 400 without an RPC", async (body) => {
    asSeat("owner");
    expect((await run(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("open_table table_already_open is 409 and seat_reservation is never called", async () => {
    asSeat("owner", {
      open_table: failure(
        "P0001",
        "table_already_open",
        JSON.stringify({ sessionId: IDS.session1 }),
      ),
    });
    const response = await run();
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("table_already_open");
    expect(names()).not.toContain("seat_reservation");
  });

  it("a retry after open_table said created:false still seats and succeeds", async () => {
    asSeat("owner", { open_table: ok({ ...OPEN, created: false }) });
    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: SESSION_1, created: false });
    expect(client.rpc).toHaveBeenCalledWith("seat_reservation", {
      p_id: RESERVATION_1,
      p_session: SESSION_1,
    });
  });

  it("a booking already seated on this session is a replay: no new open_table, seat again, 200", async () => {
    asSeat("owner", { reservation_detail: SEATED_DETAIL });
    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: SESSION_1, created: false });
    expect(names()).toEqual(["reservation_detail", "seat_reservation"]);
  });

  it("a booking that cannot be seated (declined) is 409 and opens no table", async () => {
    asSeat("owner", {
      reservation_detail: { ...SEATABLE_DETAIL, status: "declined", actions: ["erase"] },
    });
    const response = await run();
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("status_invalid");
    expect(names()).toEqual(["reservation_detail"]);
  });

  it("an accepted booking of a later day is 409 too_early and opens no table", async () => {
    asSeat("owner", {
      reservation_detail: { ...SEATABLE_DETAIL, actions: ["decline", "move", "tables", "erase"] },
    });
    const response = await run();
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("too_early");
    expect(names()).toEqual(["reservation_detail"]);
  });

  it("a booking seated on ANOTHER session is 409 status_invalid", async () => {
    asSeat("owner", { reservation_detail: { ...SEATED_DETAIL, sessionId: IDS.session1 } });
    expect((await run()).status).toBe(409);
    expect(names()).toEqual(["reservation_detail"]);
  });

  it("a booking with no assigned table needs the table in the body", async () => {
    const none = { ...SEATABLE_DETAIL, tables: [], leadTable: null };
    asSeat("owner", { reservation_detail: none });
    const response = await run();
    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe("table_required");
    expect(names()).toEqual(["reservation_detail"]);
    asSeat("owner", { reservation_detail: none });
    expect((await run({ ...BODY, tableId: TABLE_2 })).status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("open_table", {
      p_table: TABLE_2,
      p_session: SESSION_1,
      p_covers: 6,
    });
  });

  it("a tableId that is not the lead of an assigned booking is 409 table_not_assigned", async () => {
    asSeat("owner");
    const response = await run({ ...BODY, tableId: TABLE_2 });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("table_not_assigned");
    expect(names()).toEqual(["reservation_detail"]);
  });

  it.each([
    ["table_not_assigned", 409],
    ["session_closed", 409],
    ["status_invalid", 409],
    ["too_early", 409],
  ])("seat_reservation %s is %i", async (message, status) => {
    asSeat("owner", { seat_reservation: failure("P0001", message) });
    expect((await run()).status).toBe(status);
  });

  it("the seat reply never carries the customer: only { sessionId, created }", async () => {
    asSeat("owner");
    const text = JSON.stringify(await (await run()).json());
    expect(text).not.toContain("Cliente");
    expect(text).not.toContain("phone");
  });

  it("a malformed id is 404 without an RPC", async () => {
    asSeat("owner");
    expect((await run(BODY, "nope")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the detail read failing (not found) is 404 and opens nothing", async () => {
    asSeat("owner", { reservation_detail: failure("P0002", "reservation_not_found") });
    expect((await run()).status).toBe(404);
    expect(names()).toEqual(["reservation_detail"]);
  });
});
