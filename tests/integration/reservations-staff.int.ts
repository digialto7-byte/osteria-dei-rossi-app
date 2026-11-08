import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/time/venue-date";
import type { BillOutput, CloseOutput } from "@/server/bill/output";
import type { AddLineOutput, FireOutput } from "@/server/orders/output";
import type { RowView } from "@/lib/reservations/day-view";
import type { ReservationActionResult, ReservationDetail } from "@/server/reservations/output";
import type { DayServices, SessionServiceReply } from "@/server/services/output";
import type { TablesList } from "@/server/tables/output";
import { addDish, type ClosingCalls, seedClosingTenant } from "./helpers/closing";
import { emailRows, linkedSession, moveToDay, seedRequest } from "./helpers/reservations";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// Reservations (PR1, plan A14) against the real local stack: the staff side over the real routes. A customer's request has no route yet (the public page is PR2), so
// requests are seeded through psql with app.request_reservation_at (helpers/reservations.ts), the way the pgTAP tests do. Only `createSupabaseServerClient` is replaced
// (as in the M14 to M25c suites), so each call carries the signed-in test user's own client: owner, admin, chef and waiter are the stack's password users, so Postgres sees
// a real user JWT. Every date comes from `GET /api/tables` `businessDate`, never from the calendar. Fake data only: "Cliente Demo", "Tavolo 1 (demo)", example.com.
//
// Departures from the plan text, both because the real clock of a run is not the clock of the fixtures:
//  - the waiter is the stack's password waiter (the PIN path has its own suite, staff-pin.int.ts);
//  - "a booking on the day" is made with a psql update of its business date and start (helpers/reservations.ts moveToDay), not with the `move` route, which refuses
//    a start in the past: a run late in the evening has no future Cena slot today.
//
// The tests run in order and share state. Tenant A: three tables, a group, three requests and a staff booking. Tenant B: nothing but its owner. Throws in CI when the
// stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  return { createSupabaseServerClient: async () => asUser.store!.getStore() };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const diningTablesRoute = await import("@/app/api/dining-tables/route");
const settingsRoute = await import("@/app/api/settings/reservations/route");
const bookingRoute = await import("@/app/api/settings/reservations/tables/route");
const groupsRoute = await import("@/app/api/table-groups/route");
const listRoute = await import("@/app/api/reservations/route");
const detailRoute = await import("@/app/api/reservations/[id]/route");
const acceptRoute = await import("@/app/api/reservations/[id]/accept/route");
const markRoute = await import("@/app/api/reservations/[id]/mark/route");
const seatRoute = await import("@/app/api/reservations/[id]/seat/route");
const splitRoute = await import("@/app/api/reservations/[id]/split/route");
const eraseRoute = await import("@/app/api/reservations/[id]/erase-contact/route");
const tablesRoute = await import("@/app/api/tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");
const copertoRoute = await import("@/app/api/settings/coperto/route");
const linesRoute = await import("@/app/api/table-sessions/[id]/lines/route");
const fireRoute = await import("@/app/api/table-sessions/[id]/fire/route");
const voidRoute = await import("@/app/api/order-lines/[id]/void/route");
const billRoute = await import("@/app/api/table-sessions/[id]/bill/route");
const closeRoute = await import("@/app/api/table-sessions/[id]/close/route");
const serviceRoute = await import("@/app/api/table-sessions/[id]/service/route");
const dayCloseRoute = await import("@/app/api/day-close/services/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** The day reply as the owner or the waiter reads it (the waiter's rows have no emailStatus). */
interface Day {
  businessDate: string;
  services: {
    key: string;
    counts: { reservations: number; covers: number; pending: number };
    reservations: RowView[];
  }[];
}

describe.skipIf(!env)("reservations, the staff side, on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let today: string;
  let tomorrow: string;
  const table: Record<"t1" | "t2" | "t3", string> = { t1: "", t2: "", t3: "" };
  let groupId = "";
  // The three requests: R1 party 3 at 19:30, R2 party 6 at 21:30 (right after R1: back-to-back bookings do not overlap), R3 party 2 at 20:00.
  const res: Record<"r1" | "r2" | "r3" | "staff", string> = { r1: "", r2: "", r3: "", staff: "" };
  let sessionId = "";

  async function call<T = Record<string, unknown>>(
    user: TestUser,
    handler: Handler,
    path: string,
    init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
  ): Promise<Reply<T>> {
    const method = init.method ?? "GET";
    return asUser.store!.run(user.client, async () => {
      const response = await handler(
        new Request(`http://localhost:3000${path}`, {
          method,
          headers: method === "GET" ? {} : { "content-type": "application/json" },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
        { params: Promise.resolve(init.params ?? {}) },
      );
      const text = await response.text();
      const body = JSON.parse(text) as T;
      return {
        status: response.status,
        body,
        text,
        error: (body as { error?: Reply["error"] }).error as Reply["error"],
      };
    });
  }

  const day = (user: TestUser, date: string) =>
    call<Day>(user, listRoute.GET as Handler, `/api/reservations?date=${date}`);
  const detail = (user: TestUser, id: string) =>
    call<ReservationDetail>(user, detailRoute.GET as Handler, `/api/reservations/${id}`, {
      params: { id },
    });
  const post = <T = ReservationActionResult>(
    user: TestUser,
    handler: unknown,
    id: string,
    action: string,
    body: unknown,
  ) =>
    call<T>(user, handler as Handler, `/api/reservations/${id}/${action}`, {
      method: "POST",
      body,
      params: { id },
    });
  const accept = (user: TestUser, id: string, body: unknown) =>
    post(user, acceptRoute.POST, id, "accept", body);
  const rowsOf = (reply: Reply<Day>, service = "cena") =>
    reply.body.services.find((s) => s.key === service)!.reservations;
  const tilesOf = async (user: TestUser) => {
    const list = await call<TablesList>(user, tablesRoute.GET as Handler, "/api/tables");
    expect(list.status).toBe(200);
    return new Map(list.body.tables.map((tile) => [tile.id, tile]));
  };

  const calls: ClosingCalls = {
    createItem: (body) =>
      call(a.owner, menuItemsRoute.POST as Handler, "/api/menu/items", {
        method: "POST",
        body,
      }) as Promise<{ status: number; body: { item: { id: string } } }>,
    setCoperto: (body) =>
      call(a.owner, copertoRoute.PATCH as Handler, "/api/settings/coperto", {
        method: "PATCH",
        body,
      }),
    createTable: async (name, position) => {
      const made = await call<{ table: { id: string } }>(
        a.owner,
        diningTablesRoute.POST as Handler,
        "/api/dining-tables",
        { method: "POST", body: { name, position } },
      );
      return { status: made.status, tableId: made.body.table?.id };
    },
    openTable: (user, tableId, id, covers) =>
      call(user, openRoute.POST as Handler, `/api/tables/${tableId}/open`, {
        method: "POST",
        body: { sessionId: id, covers },
        params: { id: tableId },
      }),
    addLine: (user, session, body) =>
      call<AddLineOutput>(
        user,
        linesRoute.POST as Handler,
        `/api/table-sessions/${session}/lines`,
        { method: "POST", body, params: { id: session } },
      ),
    fire: (user, session, lineIds) =>
      call<FireOutput>(user, fireRoute.POST as Handler, `/api/table-sessions/${session}/fire`, {
        method: "POST",
        body: { lineIds },
        params: { id: session },
      }),
    voidLine: (user, id, body) =>
      call(user, voidRoute.POST as Handler, `/api/order-lines/${id}/void`, {
        method: "POST",
        body,
        params: { id },
      }),
  };

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    const tiles = await call<TablesList>(a.owner, tablesRoute.GET as Handler, "/api/tables");
    expect(tiles.status).toBe(200);
    today = tiles.body.businessDate;
    tomorrow = addDays(today, 1);

    for (const [index, key] of (["t1", "t2", "t3"] as const).entries()) {
      const made = await calls.createTable(`Tavolo ${index + 1} (demo)`, index + 1);
      expect(made.status).toBe(201);
      table[key] = made.tableId;
    }
  }, 300_000);

  describe("the roles", () => {
    it("the chef gets 403 on every reservation route, with no data", async () => {
      const probes: Reply[] = [
        await call(a.chef, listRoute.GET as Handler, `/api/reservations?date=${tomorrow}`),
        await call(a.chef, settingsRoute.GET as Handler, "/api/settings/reservations"),
        await call(a.chef, bookingRoute.GET as Handler, "/api/settings/reservations/tables"),
        await call(a.chef, listRoute.POST as Handler, "/api/reservations", {
          method: "POST",
          body: {
            date: tomorrow,
            time: "13:05",
            serviceKey: "pranzo",
            party: 2,
            name: "Cliente Demo",
            phone: "390000000001",
          },
        }),
        await post(a.chef, markRoute.POST, randomUUID(), "mark", { mark: "arrived" }),
      ];
      for (const probe of probes) {
        expect(probe.status).toBe(403);
        expect(probe.text).not.toContain("Cliente");
      }
    });

    it("the waiter cannot read or write the settings, the tables of a booking or the groups", async () => {
      expect(
        (await call(a.waiter, settingsRoute.GET as Handler, "/api/settings/reservations")).status,
      ).toBe(403);
      expect(
        (
          await call(a.waiter, settingsRoute.PATCH as Handler, "/api/settings/reservations", {
            method: "PATCH",
            body: { slotMinutes: 30 },
          })
        ).status,
      ).toBe(403);
      expect(
        (await call(a.waiter, bookingRoute.GET as Handler, "/api/settings/reservations/tables"))
          .status,
      ).toBe(403);
      expect(
        (
          await call(a.waiter, groupsRoute.POST as Handler, "/api/table-groups", {
            method: "POST",
            body: { name: "Tavoli 2+3", seats: 8, tableIds: [table.t2, table.t3] },
          })
        ).status,
      ).toBe(403);
    });
  });

  describe("the setup, by the owner", () => {
    it("starts with the defaults of Q-R5: Pranzo 12:00-14:00 and Cena 19:30-22:00, both online, and says what is missing", async () => {
      const read = await call<{
        ready: boolean;
        notReady: string[];
        services: {
          key: string;
          online: boolean;
          firstSeating: string | null;
          lastSeating: string | null;
        }[];
      }>(a.owner, settingsRoute.GET as Handler, "/api/settings/reservations");
      expect(read.status).toBe(200);
      expect(read.body.ready).toBe(false);
      expect(read.body.notReady).toEqual(["slug", "privacy_name", "privacy_email"]);
      const cena = read.body.services.find((s) => s.key === "cena")!;
      expect([cena.online, cena.firstSeating, cena.lastSeating]).toEqual([true, "19:30", "22:00"]);
      const pranzo = read.body.services.find((s) => s.key === "pranzo")!;
      expect([pranzo.online, pranzo.firstSeating, pranzo.lastSeating]).toEqual([
        true,
        "12:00",
        "14:00",
      ]);
    });

    it("the owner sets a limit of 40 covers per slot on Cena, the admin saves the same again with changed false", async () => {
      const services = [
        {
          key: "cena",
          online: true,
          firstSeating: "19:30",
          lastSeating: "22:00",
          coversPerSlot: 40,
          reservationsPerSlot: null,
          coversPerService: null,
        },
      ];
      const first = await call<{ changed: boolean }>(
        a.owner,
        settingsRoute.PATCH as Handler,
        "/api/settings/reservations",
        {
          method: "PATCH",
          body: { services },
        },
      );
      expect(first.status).toBe(200);
      expect(first.body.changed).toBe(true);
      const again = await call<{ changed: boolean }>(
        a.admin,
        settingsRoute.PATCH as Handler,
        "/api/settings/reservations",
        {
          method: "PATCH",
          body: { services },
        },
      );
      expect(again.status).toBe(200);
      expect(again.body.changed).toBe(false);
    });

    it("switching on before the page is ready is a 422 with the reasons", async () => {
      const refused = await call(
        a.owner,
        settingsRoute.PATCH as Handler,
        "/api/settings/reservations",
        {
          method: "PATCH",
          body: { enabled: true },
        },
      );
      expect(refused.status).toBe(422);
      expect(refused.error.code).toBe("reservations_not_ready");
      expect(refused.error.details).toEqual({ reasons: ["slug", "privacy_name", "privacy_email"] });
    });

    it("the owner marks the three tables bookable with their seats, and makes a group of Tavolo 2 and 3", async () => {
      const saved = await call<{
        changed: boolean;
        tables: { tableId: string; bookable: boolean; seats: number | null }[];
      }>(a.owner, bookingRoute.PUT as Handler, "/api/settings/reservations/tables", {
        method: "PUT",
        body: {
          tables: [
            { tableId: table.t1, bookable: true, seats: 2 },
            { tableId: table.t2, bookable: true, seats: 4 },
            { tableId: table.t3, bookable: true, seats: 4 },
          ],
        },
      });
      expect(saved.status).toBe(200);
      expect(saved.body.changed).toBe(true);
      expect(saved.body.tables.map((t) => [t.tableId, t.bookable, t.seats])).toEqual([
        [table.t1, true, 2],
        [table.t2, true, 4],
        [table.t3, true, 4],
      ]);
      const group = await call<{ group: { id: string; seats: number; tableIds: string[] } }>(
        a.owner,
        groupsRoute.POST as Handler,
        "/api/table-groups",
        { method: "POST", body: { name: "Tavoli 2+3", seats: 8, tableIds: [table.t2, table.t3] } },
      );
      expect(group.status).toBe(201);
      expect(group.body.group.seats).toBe(8);
      expect(group.body.group.tableIds).toEqual([table.t2, table.t3]);
      groupId = group.body.group.id;
      const dup = await call(a.owner, groupsRoute.POST as Handler, "/api/table-groups", {
        method: "POST",
        body: { name: "tavoli 2+3", seats: 8, tableIds: [table.t2, table.t3] },
      });
      expect(dup.status).toBe(422);
      expect(dup.error.details).toEqual({ reason: "name_taken" });
    });

    it("tenant B's table is a 404 for tenant A", async () => {
      const bTable = await call<{ table: { id: string } }>(
        b.owner,
        diningTablesRoute.POST as Handler,
        "/api/dining-tables",
        {
          method: "POST",
          body: { name: "Tavolo 1 (demo)", position: 1 },
        },
      );
      expect(bTable.status).toBe(201);
      const refused = await call(
        a.owner,
        bookingRoute.PUT as Handler,
        "/api/settings/reservations/tables",
        {
          method: "PUT",
          body: { tables: [{ tableId: bTable.body.table.id, bookable: true, seats: 4 }] },
        },
      );
      expect(refused.status).toBe(404);
    });
  });

  describe("the requests", () => {
    it("three requests seeded as a customer would send them show as pending, with the database's counts", async () => {
      const base = { date: tomorrow, serviceKey: "cena", phone: "+39 000 0000001" };
      expect(
        JSON.parse(
          seedRequest(a.id, {
            ...base,
            time: "19:30",
            party: 3,
            name: "Cliente Demo",
            email: "cliente.demo@example.com",
            ip: "203.0.113.11",
          }),
        ),
      ).toEqual({ status: "received" });
      expect(
        JSON.parse(
          seedRequest(a.id, {
            ...base,
            time: "21:30",
            party: 6,
            name: "Cliente Due Demo",
            phone: "+39 000 0000002",
            email: "cliente.due@example.com",
            ip: "203.0.113.12",
          }),
        ),
      ).toEqual({ status: "received" });
      expect(
        JSON.parse(
          seedRequest(a.id, {
            ...base,
            time: "20:00",
            party: 2,
            name: "Cliente Tre Demo",
            phone: "+39 000 0000003",
            email: "cliente.tre@example.com",
            ip: "203.0.113.13",
          }),
        ),
      ).toEqual({ status: "received" });

      const read = await day(a.owner, tomorrow);
      expect(read.status).toBe(200);
      expect(read.body.services.map((s) => s.key)).toEqual(["pranzo", "cena"]);
      const cena = read.body.services.find((s) => s.key === "cena")!;
      expect(cena.counts).toEqual({ reservations: 3, covers: 11, pending: 3 });
      expect(cena.reservations.map((r) => [r.time, r.party, r.name, r.status])).toEqual([
        ["19:30", 3, "Cliente Demo", "pending"],
        ["20:00", 2, "Cliente Tre Demo", "pending"],
        ["21:30", 6, "Cliente Due Demo", "pending"],
      ]);
      expect(read.body.services.find((s) => s.key === "pranzo")!.reservations).toEqual([]);
      const [r1, r3, r2] = cena.reservations;
      res.r1 = r1!.id;
      res.r3 = r3!.id;
      res.r2 = r2!.id;
      for (const row of cena.reservations) {
        expect(row.actions).toEqual(["accept", "decline", "move", "erase"]);
        expect(row.phone).toMatch(/^3900000000\d\d$/);
      }
    });

    it("the outbox queued a 'received' e-mail per request and sent nothing", () => {
      for (const id of [res.r1, res.r2, res.r3]) {
        expect(emailRows(id)).toEqual(["received:queued:false"]);
      }
    });

    it("the owner sees the suggestion: the smallest free table that fits (Tavolo 2 for three people)", async () => {
      const read = await detail(a.owner, res.r1);
      expect(read.status).toBe(200);
      expect(read.body.suggestion!.suggested).toMatchObject({
        kind: "table",
        tableIds: [table.t2],
        seats: 4,
      });
      expect(read.body.events.map((e) => e.kind)).toEqual(["requested"]);
      expect(Object.keys(read.body.events[0]!).sort()).toEqual(["at", "kind"]);
      // Six people: only the group fits.
      const big = await detail(a.owner, res.r2);
      expect(big.body.suggestion!.suggested).toMatchObject({
        kind: "group",
        groupId,
        tableIds: [table.t2, table.t3],
        seats: 8,
      });
    });

    it("accepting R1 with the suggestion works; a second booking on the same table at an overlapping time is 409 table_taken", async () => {
      const done = await accept(a.owner, res.r1, { tableIds: [table.t2], groupId: null });
      expect(done.status).toBe(200);
      expect(done.body.status).toBe("accepted");
      expect(done.body.changed).toBe(true);
      expect(done.body.tables.map((t) => t.id)).toEqual([table.t2]);
      // R3 is at 20:00, inside R1's 19:30 to 21:30.
      const taken = await accept(a.owner, res.r3, { tableIds: [table.t2], groupId: null });
      expect(taken.status).toBe(409);
      expect(taken.error.code).toBe("table_taken");
      // Repeating the first accept with the same tables changes nothing.
      const again = await accept(a.admin, res.r1, { tableIds: [table.t2], groupId: null });
      expect(again.status).toBe(200);
      expect(again.body.changed).toBe(false);
    });

    it("R2 (21:30, right after R1 ends) takes the group, and the outbox has the accepted e-mails queued", async () => {
      const done = await accept(a.owner, res.r2, { tableIds: [table.t2, table.t3], groupId });
      expect(done.status).toBe(200);
      expect(done.body.groupName).toBe("Tavoli 2+3");
      expect(done.body.groupId).toBe(groupId);
      expect(done.body.leadTable).toEqual({ id: table.t2, name: "Tavolo 2 (demo)" });
      expect(done.body.tables.map((t) => [t.name, t.joinedTo?.name ?? null])).toEqual([
        ["Tavolo 2 (demo)", null],
        ["Tavolo 3 (demo)", "Tavolo 2 (demo)"],
      ]);
      expect(emailRows(res.r1)).toEqual(["received:queued:false", "accepted:queued:false"]);
      expect(emailRows(res.r2)).toEqual(["received:queued:false", "accepted:queued:false"]);
      // R3 is accepted without a table.
      const none = await accept(a.owner, res.r3, { tableIds: null, groupId: null });
      expect(none.status).toBe(200);
      expect(none.body.tables).toEqual([]);
    });

    it("tenant B sees none of A's bookings and cannot read or act on them", async () => {
      const read = await day(b.owner, tomorrow);
      expect(read.status).toBe(200);
      for (const service of read.body.services) expect(service.reservations).toEqual([]);
      expect(read.text).not.toContain("Cliente");
      for (const id of [res.r1, res.r2, res.r3]) {
        expect((await detail(b.owner, id)).status).toBe(404);
        expect((await accept(b.owner, id, { tableIds: null, groupId: null })).status).toBe(404);
        expect((await post(b.owner, eraseRoute.POST, id, "erase-contact", {})).status).toBe(404);
      }
    });
  });

  describe("the waiter", () => {
    it("sees the customer's name and phone, with no e-mail status and no suggestion, and cannot accept", async () => {
      const read = await day(a.waiter, tomorrow);
      expect(read.status).toBe(200);
      const row = rowsOf(read).find((r) => r.id === res.r1)!;
      expect(row.name).toBe("Cliente Demo");
      expect(row.phone).toBe("390000000001");
      expect(read.text).not.toContain("emailStatus");
      const one = await detail(a.waiter, res.r1);
      expect(one.status).toBe(200);
      expect(one.text).not.toContain("suggestion");
      expect(one.text).not.toContain("emailStatus");
      // R3 was accepted above, so only "arrived" and "seat" are possible, and only on the day: tomorrow's booking has neither.
      expect(row.actions).toEqual([]);
      for (const id of [res.r1, res.r2, res.r3]) {
        const refused = await accept(a.waiter, id, { tableIds: null, groupId: null });
        expect(refused.status).toBe(403);
      }
      expect((await post(a.waiter, eraseRoute.POST, res.r1, "erase-contact", {})).status).toBe(403);
    });

    it("types a booking taken by phone: it starts accepted, source staff, and with no e-mail it queues none", async () => {
      const made = await call<ReservationActionResult>(
        a.waiter,
        listRoute.POST as Handler,
        "/api/reservations",
        {
          method: "POST",
          body: {
            date: tomorrow,
            time: "13:05",
            serviceKey: "pranzo",
            party: 12,
            name: "Cliente Telefono Demo",
            phone: "+39 000 0000004",
          },
        },
      );
      expect(made.status).toBe(201);
      expect(made.body.status).toBe("accepted");
      expect(made.body.source).toBe("staff");
      expect(made.body.party).toBe(12);
      res.staff = made.body.id;
      expect(emailRows(res.staff)).toEqual([]);
    });

    it("a booking in the past is 422 date_past and a time inside no service is 422 service_invalid", async () => {
      const body = { serviceKey: "pranzo", party: 2, name: "Cliente Demo", phone: "390000000001" };
      const past = await call(a.waiter, listRoute.POST as Handler, "/api/reservations", {
        method: "POST",
        body: { ...body, date: addDays(today, -1), time: "13:05" },
      });
      expect(past.status).toBe(422);
      expect(past.error.code).toBe("date_past");
      const notService = await call(a.waiter, listRoute.POST as Handler, "/api/reservations", {
        method: "POST",
        body: { ...body, date: tomorrow, time: "13:05", serviceKey: "cena" },
      });
      expect(notService.status).toBe(422);
      expect(notService.error.code).toBe("service_invalid");
    });

    it("the day read has a window: 62 days back is read, 63 back and 400 days ahead are 422 date_invalid", async () => {
      expect((await day(a.waiter, addDays(today, -62))).status).toBe(200);
      for (const date of [addDays(today, -63), addDays(today, 400)]) {
        const refused = await day(a.waiter, date);
        expect(refused.status).toBe(422);
        expect(refused.error.code).toBe("date_invalid");
      }
    });

    it("marks R2 arrived on its day, and cannot do it the day before", async () => {
      const early = await post(a.waiter, markRoute.POST, res.r2, "mark", { mark: "arrived" });
      expect(early.status).toBe(409);
      expect(early.error.code).toBe("too_early");
      moveToDay(res.r2, today);
      const arrived = await post<ReservationActionResult>(
        a.waiter,
        markRoute.POST,
        res.r2,
        "mark",
        { mark: "arrived" },
      );
      expect(arrived.status).toBe(200);
      expect(arrived.body.status).toBe("arrived");
      expect(arrived.body.changed).toBe(true);
      expect(arrived.body.actions).toContain("seat");
      expect(arrived.text).not.toContain("emailStatus");
    });
  });

  describe("seating a combined booking", () => {
    it("opens ONE session on the lead table (Tavolo 2) with the party as covers, and links it to the booking", async () => {
      sessionId = randomUUID();
      const seated = await post<{ sessionId: string; created: boolean }>(
        a.waiter,
        seatRoute.POST,
        res.r2,
        "seat",
        {
          sessionId,
          covers: 6,
        },
      );
      expect(seated.status).toBe(200);
      expect(seated.body).toEqual({ sessionId, created: true });
      expect(linkedSession(res.r2)).toBe(`${table.t2}:6`);
      const tiles = await tilesOf(a.waiter);
      expect(tiles.get(table.t2)!.status).toBe("open");
      expect(tiles.get(table.t2)!.session!.covers).toBe(6);
      // A retry with the same session id is a replay: 200, created false, still one session.
      const retry = await post<{ sessionId: string; created: boolean }>(
        a.waiter,
        seatRoute.POST,
        res.r2,
        "seat",
        {
          sessionId,
          covers: 6,
        },
      );
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual({ sessionId, created: false });
    });

    it("the other table of the group is joined to the lead: Sala shows it so, and opening it is 409 table_joined", async () => {
      const tiles = await tilesOf(a.waiter);
      const joined = tiles.get(table.t3)!;
      expect(joined.status).toBe("joined");
      expect(joined.session).toBeNull();
      expect(joined.joinedTo).toEqual({
        id: table.t2,
        name: "Tavolo 2 (demo)",
        overtime: false,
      });
      expect(tiles.get(table.t1)!.status).toBe("free");
      expect(tiles.get(table.t1)!.joinedTo).toBeUndefined();
      const refused = await calls.openTable(a.waiter, table.t3, randomUUID(), 2);
      expect(refused.status).toBe(409);
      const reply = (refused as unknown as Reply).error;
      expect(reply.code).toBe("table_joined");
      expect(reply.message).toBe(
        "Il tavolo è unito a una prenotazione: aprilo dal tavolo principale.",
      );
    });

    it("the day view says seated, with 'split' as the action, and the booking's tables keep their lead", async () => {
      const read = await day(a.waiter, today);
      const row = rowsOf(read).find((r) => r.id === res.r2)!;
      expect(row.status).toBe("seated");
      expect(row.sessionId).toBe(sessionId);
      expect(row.actions).toEqual(["split"]);
      expect(row.tables.find((t) => t.id === table.t3)!.joinedTo).toEqual({
        id: table.t2,
        name: "Tavolo 2 (demo)",
      });
    });

    it("the waiter splits Tavolo 3 off: it is free in Sala while the lead stays seated; a second split changes nothing", async () => {
      const split = await post<ReservationActionResult>(
        a.waiter,
        splitRoute.POST,
        res.r2,
        "split",
        {},
      );
      expect(split.status).toBe(200);
      expect(split.body.changed).toBe(true);
      expect(split.body.tables.map((t) => t.id)).toEqual([table.t2]);
      const tiles = await tilesOf(a.waiter);
      expect(tiles.get(table.t3)!.status).toBe("free");
      expect(tiles.get(table.t2)!.status).toBe("open");
      const again = await post<ReservationActionResult>(
        a.waiter,
        splitRoute.POST,
        res.r2,
        "split",
        {},
      );
      expect(again.status).toBe(200);
      expect(again.body.changed).toBe(false);
      expect(await post(a.chef, splitRoute.POST, res.r2, "split", {})).toMatchObject({
        status: 403,
      });
    });
  });

  describe("the bill and the day close are those of an ordinary table", () => {
    it("the session closes through the bill like any other, and the day close counts it", async () => {
      const fixture = await seedClosingTenant(stack, a, calls);
      const line = await addDish(calls, a.waiter, sessionId, fixture.items.stew);
      expect((await calls.fire(a.waiter, sessionId, [line])).status).toBe(200);
      const preview = await call<BillOutput>(
        a.waiter,
        billRoute.GET as Handler,
        `/api/table-sessions/${sessionId}/bill`,
        {
          params: { id: sessionId },
        },
      );
      expect(preview.status).toBe(200);
      const closed = await call<CloseOutput>(
        a.waiter,
        closeRoute.POST as Handler,
        `/api/table-sessions/${sessionId}/close`,
        {
          method: "POST",
          body: {
            receiptType: "scontrino",
            receiptNumber: "0201",
            paymentType: "card",
            billToken: preview.body.billToken,
          },
          params: { id: sessionId },
        },
      );
      expect(closed.status).toBe(200);

      const split = await call<DayServices>(
        a.owner,
        dayCloseRoute.GET as Handler,
        `/api/day-close/services?date=${today}`,
      );
      expect(split.status).toBe(200);
      const mine = split.body.sessions.find((s) => s.sessionId === sessionId)!;
      expect(mine.tableName).toBe("Tavolo 2 (demo)");
      expect(mine.covers).toBe(6);
      expect(mine.closedAt).not.toBeNull();
      expect(mine.choices).toContain(mine.serviceKey);
      // The table opened at the real clock, so its service is the clock's; move it to Cena like any table and Cena counts it.
      const moved = await call<SessionServiceReply>(
        a.owner,
        serviceRoute.POST as Handler,
        `/api/table-sessions/${sessionId}/service`,
        {
          method: "POST",
          body: { serviceKey: "cena" },
          params: { id: sessionId },
        },
      );
      expect(moved.status).toBe(200);
      const after = await call<DayServices>(
        a.owner,
        dayCloseRoute.GET as Handler,
        `/api/day-close/services?date=${today}`,
      );
      const cena = after.body.services.find((s) => s.key === "cena")!;
      expect([cena.tables, cena.covers]).toEqual([1, 6]);
      expect(after.body.total.tables).toBe(1);
    });

    it("with the lead session closed, no table of Sala is joined", async () => {
      const tiles = await tilesOf(a.waiter);
      expect(tiles.get(table.t3)!.status).toBe("free");
      expect(tiles.get(table.t2)!.joinedTo).toBeUndefined();
    });
  });

  describe("erasing a customer's data", () => {
    it("the owner erases R3's data: the booking stays, the name and phone are null, the queued e-mail is skipped", async () => {
      const erased = await post<ReservationActionResult>(
        a.owner,
        eraseRoute.POST,
        res.r3,
        "erase-contact",
        {},
      );
      expect(erased.status).toBe(200);
      expect(erased.body.changed).toBe(true);
      expect([erased.body.name, erased.body.phone, erased.body.email]).toEqual([null, null, null]);
      // Each row reads kind:status:sent.
      expect(emailRows(res.r3).every((row) => row.includes(":skipped:"))).toBe(true);
      const read = await day(a.waiter, tomorrow);
      const row = rowsOf(read).find((r) => r.id === res.r3)!;
      expect([row.name, row.phone, row.email]).toEqual([null, null, null]);
      expect(read.text).not.toContain("Cliente Tre");
    });
  });
});
