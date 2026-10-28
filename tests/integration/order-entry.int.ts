import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { ServiceMenu, ServiceMenuItem } from "@/server/menu/output";
import { serviceMenuOutput } from "@/server/menu/output";
import {
  addLineOutput,
  lineWriteOutput,
  orderViewOutput,
  type AddLineOutput,
  type OrderLine,
  type OrderView,
} from "@/server/orders/output";
import type { TableSession } from "@/server/tables/output";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { NAMES, seedOrderTenant, type OrderFixture } from "./helpers/orders";
import { quoteUuid, runSql } from "./helpers/sql";

// M18 acceptance tests 1 to 5 against the real local stack. The routes run for real (schemas, role checks, error
// mapping, menu_list, add_order_line, update_order_line, remove_order_line, order_view, RLS, the guard triggers); only
// `createSupabaseServerClient` is replaced, as in the M14 to M17 suites, so each call carries the signed-in test user's
// own client and two calls can be in flight together (the idempotency test sends one POST twice at once). Recipes,
// batches (the production route) and menu items go through the owner's and the chef's APIs. The secret key counts
// order_line rows only (select is granted to service_role); it never reads `recipe` or `recipe_key` (lesson 3). The push
// columns are written with SQL on the LOCAL database (M23 owns the API for them). Fake data only.
//
// The tests run in order and share state. Tenant A: two locations, a stew batch of 3 portions, a ragù batch of 10,
// six menu items, two waiters. Tenant B: one unmapped dish, one table with a session. Throws in CI when the stack
// settings are missing; skips on a developer machine.
const env = readStackEnv();

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  return { createSupabaseServerClient: async () => asUser.store!.getStore() };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const recipesRoute = await import("@/app/api/recipes/route");
const proposalRoute = await import("@/app/api/batches/proposal/route");
const batchesRoute = await import("@/app/api/batches/route");
const discardRoute = await import("@/app/api/batches/[id]/discard/route");
const meRoute = await import("@/app/api/me/route");
const menuRoute = await import("@/app/api/menu/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const linesRoute = await import("@/app/api/table-sessions/[id]/lines/route");
const lineRoute = await import("@/app/api/order-lines/[id]/route");
const removeRoute = await import("@/app/api/order-lines/[id]/remove/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
  error: {
    code: string;
    message: string;
    details?: { reason?: string; line?: OrderLine; menuItemId?: string; portionsLeft?: number };
  };
}

/** Property names at any depth of a JSON value. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];
// What a waiter may never see (plan §3.1.9): costs, margins, GP, food cost, EUR-named values, recipe identity, VAT.
const WAITER_FORBIDDEN = /cost|margin|gp|food|eur$|recipe|vat/i;

const today = venueDate(new Date());
const day = (offset: number) => addDays(today, offset);
/** An instant `ms` from now, as the phone would send it. */
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

describe.skipIf(!env)("order entry on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fa: OrderFixture;
  let waiter2: TestUser;
  let t1: string;
  let s1: string;
  let tb1: string;
  let sb1: string;
  let bItemId: string;
  /** The first stew line of table 1 (qty 1, secondi), found by id from here on. */
  let stewLineId: string;
  const nameOf = new Map<string, string>();

  // Every JSON text the chef received from an M18 route, scanned for euro signs at the end (project V6).
  const chefTexts: string[] = [];

  /** One request to a real route handler, as the given user. */
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
      if (user === a.chef && /^\/api\/(menu|table-sessions|order-lines)/.test(path))
        chefTexts.push(text);
      const body = JSON.parse(text) as T;
      return {
        status: response.status,
        body,
        text,
        headers: response.headers,
        error: (body as { error?: Reply["error"] }).error as Reply["error"],
      };
    });
  }

  const menu = (user: TestUser) => call<ServiceMenu>(user, menuRoute.GET as Handler, "/api/menu");
  const view = (user: TestUser, session: string) =>
    call<OrderView>(user, linesRoute.GET as Handler, `/api/table-sessions/${session}/lines`, {
      params: { id: session },
    });
  const addLine = (user: TestUser, session: string, body: object) =>
    call<AddLineOutput>(user, linesRoute.POST as Handler, `/api/table-sessions/${session}/lines`, {
      method: "POST",
      body,
      params: { id: session },
    });
  const patchLine = (user: TestUser, id: string, body: object) =>
    call<{ changed: boolean; line: OrderLine }>(
      user,
      lineRoute.PATCH as Handler,
      `/api/order-lines/${id}`,
      { method: "PATCH", body, params: { id } },
    );
  const removeLine = (user: TestUser, id: string, body: object) =>
    call<{ changed: boolean; line: OrderLine }>(
      user,
      removeRoute.POST as Handler,
      `/api/order-lines/${id}/remove`,
      { method: "POST", body, params: { id } },
    );
  const discard = (user: TestUser, id: string, body: object) =>
    call(user, discardRoute.POST as Handler, `/api/batches/${id}/discard`, {
      method: "POST",
      body,
      params: { id },
    });

  /** A menu item found by id, never by position (lesson 4). */
  const itemOf = (list: ServiceMenu, id: string): ServiceMenuItem =>
    list.categories.flatMap((c) => c.items).find((item) => item.id === id)!;
  /** A line found by id. */
  const lineOf = (list: OrderView, id: string): OrderLine => list.lines.find((l) => l.id === id)!;
  /** How many order_line rows carry this id, read with the secret key (select is granted to service_role). */
  const countLines = async (id: string) => {
    const read = await stack.admin.from("order_line").select("id").eq("id", id);
    expect(read.error).toBeNull();
    return (read.data ?? []).length;
  };
  /** The body of a tap on a dish. */
  const tap = (menuItemId: string, extra: object = {}) => ({
    lineId: randomUUID(),
    menuItemId,
    clientUpdatedAt: at(-60_000),
    ...extra,
  });

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;

    const approve = async (invoiceId: string, locationId: string) =>
      (
        await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
          method: "POST",
          body: { locationId },
          params: { id: invoiceId },
        })
      ).status;
    fa = await seedOrderTenant(stack, a, {
      createRecipe: (body: object) =>
        call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { recipe: { key: string } } }>,
      approve,
      day,
      versionOf: async (key) =>
        (
          await call<{ recipe: { id: string } }>(
            a.chef,
            proposalRoute.GET as Handler,
            `/api/batches/proposal?recipeKey=${key}`,
          )
        ).body.recipe.id,
      produce: (body) =>
        call(a.chef, batchesRoute.POST as Handler, "/api/batches", {
          method: "POST",
          body,
        }) as Promise<{
          status: number;
          body: { batchId: string; lotCode: string; portions: number };
        }>,
      createItem: (body) =>
        call(a.owner, menuItemsRoute.POST as Handler, "/api/menu/items", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { item: { id: string } } }>,
    });
    waiter2 = fa.waiter2;

    // Tenant A's table and session (waiter A opens it), tenant B's table, session and one dish.
    const table = await call<{ table: { id: string } }>(
      a.owner,
      diningTablesRoute.POST as Handler,
      "/api/dining-tables",
      { method: "POST", body: { name: "Tavolo 1 (demo)", position: 1 } },
    );
    expect(table.status).toBe(201);
    t1 = table.body.table.id;
    s1 = randomUUID();
    const opened = await call<{ created: boolean; session: TableSession }>(
      a.waiter,
      openRoute.POST as Handler,
      `/api/tables/${t1}/open`,
      { method: "POST", body: { sessionId: s1, covers: 4 }, params: { id: t1 } },
    );
    expect(opened.status).toBe(201);

    const tableB = await call<{ table: { id: string } }>(
      b.owner,
      diningTablesRoute.POST as Handler,
      "/api/dining-tables",
      { method: "POST", body: { name: "Tavolo 1 (demo)", position: 1 } },
    );
    expect(tableB.status).toBe(201);
    tb1 = tableB.body.table.id;
    sb1 = randomUUID();
    expect(
      (
        await call(b.waiter, openRoute.POST as Handler, `/api/tables/${tb1}/open`, {
          method: "POST",
          body: { sessionId: sb1, covers: 2 },
          params: { id: tb1 },
        })
      ).status,
    ).toBe(201);
    const itemB = await call<{ item: { id: string } }>(
      b.owner,
      menuItemsRoute.POST as Handler,
      "/api/menu/items",
      {
        method: "POST",
        body: {
          name: "Acqua (demo)",
          category: "Bevande",
          course: "bevande",
          recipeKey: null,
          price: 3,
          vatRate: 22,
        },
      },
    );
    expect(itemB.status).toBe(201);
    bItemId = itemB.body.item.id;

    for (const user of [a.waiter, waiter2]) {
      const me = await call<{ user: { displayName: string } }>(
        user,
        meRoute.GET as Handler,
        "/api/me",
      );
      nameOf.set(user.authId, me.body.user.displayName);
    }
  }, 300_000);

  describe("the menu with availability (AT2) and the waiter's shape", () => {
    it("GET /api/menu is the strict schema; item keys are the eleven of the plan and carry no cost", async () => {
      const reply = await menu(a.waiter);
      expect(reply.status).toBe(200);
      expect(serviceMenuOutput.safeParse(reply.body).success).toBe(true);
      expect(keysOf(reply.body).filter((key) => WAITER_FORBIDDEN.test(key))).toEqual([]);
      const items = reply.body.categories.flatMap((c) => c.items);
      expect(items.map((i) => i.id).sort()).toEqual(Object.values(fa.items).sort());
      expect(reply.body.pinned).toEqual([]);
    });

    it("AT2: the stew batch has 3 portions, so 'portionsLeft' is 3 and 'lowStock' is true", async () => {
      const stew = itemOf((await menu(a.waiter)).body, fa.items.stew);
      expect(stew).toMatchObject({
        name: NAMES.stew,
        available: true,
        unavailableReason: null,
        portionsLeft: 3,
        lowStock: true,
      });
    });

    it("the ragù batch has 10 portions: no hint; unmapped dishes have no stock limit", async () => {
      const list = (await menu(a.waiter)).body;
      expect(itemOf(list, fa.items.tagliatelle)).toMatchObject({
        available: true,
        portionsLeft: 10,
        lowStock: false,
      });
      expect(itemOf(list, fa.items.acqua)).toMatchObject({
        available: true,
        portionsLeft: null,
        lowStock: false,
      });
    });

    it("the owner and the admin read the same menu as the waiter (one cacheable shape)", async () => {
      const waiter = (await menu(a.waiter)).body;
      expect((await menu(a.owner)).body).toEqual(waiter);
      expect((await menu(a.admin)).body).toEqual(waiter);
    });

    it("lesson 1: a third location added between two reads changes nothing", async () => {
      const before = (await menu(a.waiter)).body;
      const made = await stack.admin
        .from("location")
        .insert({ tenant_id: a.id, name: "Frigo bar (demo)" });
      expect(made.error).toBeNull();
      expect((await menu(a.waiter)).body).toEqual(before);
    });

    it("tenant B's menu has its own dish only", async () => {
      const list = (await menu(b.waiter)).body;
      expect(list.categories.flatMap((c) => c.items.map((i) => i.id))).toEqual([bItemId]);
    });
  });

  describe("adding lines: defaults, price, idempotency", () => {
    it("a tap with no course puts a secondi dish in secondi and a primi dish in primi (two candidates)", async () => {
      const stew = await addLine(a.waiter, s1, tap(fa.items.stew));
      expect(stew.status).toBe(201);
      stewLineId = stew.body.line.id;
      expect(addLineOutput.safeParse(stew.body).success).toBe(true);
      expect(stew.body.line).toMatchObject({
        name: NAMES.stew,
        course: "secondi",
        qty: 1,
        unitPrice: 14,
        state: "draft",
        segue: false,
        isShared: false,
        note: null,
      });
      expect(stew.body.item).toMatchObject({
        id: fa.items.stew,
        portionsLeft: 3,
        lowStock: true,
        unavailableReason: null,
      });

      const pasta = await addLine(a.waiter, s1, tap(fa.items.tagliatelle));
      expect(pasta.status).toBe(201);
      expect(pasta.body.line).toMatchObject({ course: "primi", unitPrice: 11 });
      expect(pasta.body.item).toMatchObject({ portionsLeft: 10, lowStock: false });
    });

    it("an explicit course wins over the dish's default", async () => {
      const reply = await addLine(a.waiter, s1, tap(fa.items.stew, { course: "primi" }));
      expect(reply.body.line.course).toBe("primi");
    });

    it("AT3: a half portion and the shared flag are stored, and a move to another course persists", async () => {
      const body = tap(fa.items.zuppa, {
        qty: 0.5,
        isShared: true,
        course: "primi",
        note: "  senza cipolla  ",
      });
      const added = await addLine(a.waiter, s1, body);
      expect(added.status).toBe(201);
      expect(added.body.line).toMatchObject({
        qty: 0.5,
        isShared: true,
        course: "primi",
        note: "senza cipolla",
        unitPrice: 9,
      });
      const id = added.body.line.id;
      const read = await view(a.waiter, s1);
      expect(lineOf(read.body, id)).toMatchObject({ qty: 0.5, isShared: true });

      const moved = await patchLine(a.waiter, id, {
        course: "secondi",
        clientUpdatedAt: at(-30_000),
      });
      expect(moved.status).toBe(200);
      expect(moved.body.changed).toBe(true);
      expect(lineOf((await view(a.waiter, s1)).body, id)).toMatchObject({
        course: "secondi",
        qty: 0.5,
        isShared: true,
      });
    });

    it("a quantity off the half-portion grid and a long note are refused", async () => {
      expect((await addLine(a.waiter, s1, tap(fa.items.acqua, { qty: 0.3 }))).status).toBe(400);
      const long = await addLine(a.waiter, s1, tap(fa.items.acqua, { note: "x".repeat(141) }));
      expect(long.status).toBe(400);
    });

    it("a phone more than two minutes ahead is refused with client_time_invalid", async () => {
      const reply = await addLine(
        a.waiter,
        s1,
        tap(fa.items.acqua, { clientUpdatedAt: at(300_000) }),
      );
      expect([reply.status, reply.error.code]).toEqual([422, "client_time_invalid"]);
    });

    it("the same POST twice is applied once: 201, then 200 with created false", async () => {
      const body = tap(fa.items.bruschetta);
      const first = await addLine(a.waiter, s1, body);
      const second = await addLine(a.waiter, s1, body);
      expect([first.status, second.status]).toEqual([201, 200]);
      expect([first.body.created, second.body.created]).toEqual([true, false]);
      expect(second.body.line).toEqual(first.body.line);
      expect(await countLines(body.lineId)).toBe(1);
    });

    it("the same POST sent twice at once leaves one line: one 201 and one 200", async () => {
      const body = tap(fa.items.acqua);
      const [one, two] = await Promise.all([
        addLine(a.waiter, s1, body),
        addLine(a.waiter, s1, body),
      ]);
      expect([one.status, two.status].sort()).toEqual([200, 201]);
      expect(await countLines(body.lineId)).toBe(1);
    });

    it("a line id reused for another dish is a 409 line_id_conflict", async () => {
      const body = tap(fa.items.acqua);
      expect((await addLine(a.waiter, s1, body)).status).toBe(201);
      const clash = await addLine(a.waiter, s1, { ...body, menuItemId: fa.items.tiramisu });
      expect([clash.status, clash.error.code]).toEqual([409, "line_id_conflict"]);
      expect(await countLines(body.lineId)).toBe(1);
    });

    it("every reply carries Server-Timing with auth, rpc and total", async () => {
      const reply = await view(a.waiter, s1);
      expect(reply.headers.get("server-timing")).toMatch(
        /^auth;dur=[\d.]+, rpc;dur=[\d.]+, total;dur=[\d.]+$/,
      );
    });

    it("order_view is the strict schema; the lines are in course order and carry the sale price only", async () => {
      const reply = await view(a.waiter, s1);
      expect(reply.status).toBe(200);
      expect(orderViewOutput.safeParse(reply.body).success).toBe(true);
      expect(keysOf(reply.body).filter((key) => WAITER_FORBIDDEN.test(key))).toEqual([]);
      expect(reply.body.session).toMatchObject({ id: s1, tableName: "Tavolo 1 (demo)", covers: 4 });
      const order = ["antipasti", "primi", "secondi", "dolci", "bevande"];
      const courses = reply.body.lines.map((l) => order.indexOf(l.course));
      expect(courses).toEqual([...courses].sort((x, y) => x - y));
    });
  });

  describe("AT5: two waiters, one line", () => {
    let base: number;
    const stamp = (offsetMs: number) => new Date(base + offsetMs).toISOString();

    it("A edits at t2, then B edits at t1 < t2: B gets 409 conflict with A's line, nothing changes", async () => {
      base = Date.now();
      const added = await addLine(
        a.waiter,
        s1,
        tap(fa.items.zuppa, { clientUpdatedAt: stamp(-20_000) }),
      );
      const id = added.body.line.id;

      const mine = await patchLine(a.waiter, id, {
        note: "ben cotto",
        clientUpdatedAt: stamp(-5_000),
      });
      expect(mine.status).toBe(200);
      const theirs = await patchLine(waiter2, id, { qty: 2, clientUpdatedAt: stamp(-10_000) });
      expect(theirs.status).toBe(409);
      expect(theirs.error.code).toBe("conflict");
      expect(theirs.error.details?.reason).toBe("stale");
      expect(theirs.error.details?.line).toEqual(mine.body.line);
      expect(theirs.error.details?.line?.updatedBy.displayName).toBe(nameOf.get(a.waiter.authId));
      expect(theirs.error.message).toContain(nameOf.get(a.waiter.authId)!);

      const read = lineOf((await view(waiter2, s1)).body, id);
      expect(read).toMatchObject({ note: "ben cotto", qty: 1 });
    });

    it("B edits at t1, then A edits at t2 > t1: both are applied and the later one wins on a shared field", async () => {
      base = Date.now();
      const added = await addLine(
        a.waiter,
        s1,
        tap(fa.items.zuppa, { clientUpdatedAt: stamp(-20_000) }),
      );
      const id = added.body.line.id;

      const first = await patchLine(waiter2, id, {
        note: "poco sale",
        qty: 2,
        clientUpdatedAt: stamp(-10_000),
      });
      const second = await patchLine(a.waiter, id, {
        note: "ben cotto",
        clientUpdatedAt: stamp(-5_000),
      });
      expect([first.status, second.status]).toEqual([200, 200]);
      const read = lineOf((await view(a.waiter, s1)).body, id);
      expect(read).toMatchObject({ note: "ben cotto", qty: 2 });
      expect(read.updatedBy.displayName).toBe(nameOf.get(a.waiter.authId));
    });

    it("the same PATCH twice: changed true, then a no-op replay with changed false", async () => {
      base = Date.now();
      const added = await addLine(
        a.waiter,
        s1,
        tap(fa.items.bruschetta, { clientUpdatedAt: stamp(-20_000) }),
      );
      const id = added.body.line.id;
      const body = { segue: true, clientUpdatedAt: stamp(-5_000) };
      const one = await patchLine(a.waiter, id, body);
      const two = await patchLine(a.waiter, id, body);
      expect([one.status, two.status]).toEqual([200, 200]);
      expect([one.body.changed, two.body.changed]).toEqual([true, false]);
      expect(lineWriteOutput.safeParse(two.body).success).toBe(true);
    });

    it("removing a line takes it out of the view; a later edit is a conflict 'voided'", async () => {
      base = Date.now();
      const added = await addLine(
        a.waiter,
        s1,
        tap(fa.items.acqua, { clientUpdatedAt: stamp(-20_000) }),
      );
      const id = added.body.line.id;
      const gone = await removeLine(a.waiter, id, { clientUpdatedAt: stamp(-10_000) });
      expect([gone.status, gone.body.changed]).toEqual([200, true]);
      expect((await view(a.waiter, s1)).body.lines.some((l) => l.id === id)).toBe(false);
      // Nothing was deleted: the row is still there, voided.
      expect(await countLines(id)).toBe(1);
      const late = await patchLine(waiter2, id, { qty: 3, clientUpdatedAt: stamp(-5_000) });
      expect([late.status, late.error.code, late.error.details?.reason]).toEqual([
        409,
        "conflict",
        "voided",
      ]);
    });
  });

  describe("AT4: pushed dishes come first with their push price", () => {
    it("a pushed dish is the first of 'pinned' with its push price, and it also stays in its category", async () => {
      runSql(
        `update menu_item set push_until = now() + interval '2 hours', push_price = 4.5 where id = ${quoteUuid(fa.items.tiramisu)}`,
      );
      const list = (await menu(a.waiter)).body;
      expect(list.pinned.map((i) => i.id)).toEqual([fa.items.tiramisu]);
      expect(list.pinned[0]).toMatchObject({ pushed: true, pushPrice: 4.5, price: 6 });
      expect(itemOf(list, fa.items.tiramisu)).toMatchObject({ pushed: true, pushPrice: 4.5 });
    });

    it("the line takes the push price, and it holds after the push has ended", async () => {
      const added = await addLine(a.waiter, s1, tap(fa.items.tiramisu));
      expect(added.body.line.unitPrice).toBe(4.5);
      runSql(
        `update menu_item set push_until = now() - interval '1 minute' where id = ${quoteUuid(fa.items.tiramisu)}`,
      );
      const list = (await menu(a.waiter)).body;
      expect(list.pinned).toEqual([]);
      expect(itemOf(list, fa.items.tiramisu)).toMatchObject({ pushed: false, price: 6 });
      expect(lineOf((await view(a.waiter, s1)).body, added.body.line.id).unitPrice).toBe(4.5);
      // An expired push no longer lowers the price of a new line.
      const later = await addLine(a.waiter, s1, tap(fa.items.tiramisu));
      expect(later.body.line.unitPrice).toBe(6);
    });
  });

  describe("AT1: a dish with no portions left is refused", () => {
    it("the chef discards the ragù batch to 0: the menu greys the dish and the add is a 409 item_unavailable", async () => {
      const gone = await discard(a.chef, fa.raguBatchId, { portions: 10, reason: "spoilage" });
      expect(gone.status).toBe(201);

      const tagliatelle = itemOf((await menu(a.waiter)).body, fa.items.tagliatelle);
      expect(tagliatelle).toMatchObject({
        available: false,
        unavailableReason: "no_portions",
        portionsLeft: 0,
        lowStock: false,
      });

      const before = (await view(a.waiter, s1)).body.lines.length;
      const refused = await addLine(a.waiter, s1, tap(fa.items.tagliatelle));
      expect([refused.status, refused.error.code]).toEqual([409, "item_unavailable"]);
      expect(refused.error.details).toEqual({
        menuItemId: fa.items.tagliatelle,
        reason: "no_portions",
        portionsLeft: 0,
      });
      expect((await view(a.waiter, s1)).body.lines.length).toBe(before);
    });

    it("a replay of an add made before the stock ran out still answers 200 (nothing is re-checked)", async () => {
      // The stew has 3 portions; add it, then empty its batch, then send the same POST again.
      const body = tap(fa.items.stew);
      expect((await addLine(a.waiter, s1, body)).status).toBe(201);
      expect(
        (await discard(a.chef, fa.stewBatchId, { portions: 3, reason: "spoilage" })).status,
      ).toBe(201);
      const replay = await addLine(a.waiter, s1, body);
      expect([replay.status, replay.body.created]).toEqual([200, false]);
    });

    it("raising the quantity of a dish that ran out is a 409; lowering it is accepted", async () => {
      const up = await patchLine(a.waiter, stewLineId, { qty: 2, clientUpdatedAt: at(-1_000) });
      expect([up.status, up.error.code]).toEqual([409, "item_unavailable"]);
      expect(up.error.details).toMatchObject({ menuItemId: fa.items.stew, reason: "no_portions" });
      const move = await patchLine(a.waiter, stewLineId, {
        course: "dolci",
        clientUpdatedAt: at(-500),
      });
      expect(move.status).toBe(200);
    });
  });

  describe("roles and tenancy", () => {
    it("the chef gets 403 on the view, the add, the edit and the remove, and nothing is written", async () => {
      const id = stewLineId;
      const body = tap(fa.items.acqua);
      expect((await view(a.chef, s1)).status).toBe(403);
      expect((await addLine(a.chef, s1, body)).status).toBe(403);
      expect((await patchLine(a.chef, id, { qty: 2, clientUpdatedAt: at(-100) })).status).toBe(403);
      expect((await removeLine(a.chef, id, { clientUpdatedAt: at(-100) })).status).toBe(403);
      expect((await menu(a.chef)).status).toBe(403);
      expect(await countLines(body.lineId)).toBe(0);
    });

    it("the owner and the admin may take an order", async () => {
      expect((await addLine(a.owner, s1, tap(fa.items.acqua))).status).toBe(201);
      expect((await addLine(a.admin, s1, tap(fa.items.acqua))).status).toBe(201);
    });

    it("a waiter and a chef read no order_line row directly (RLS: 0 rows)", async () => {
      for (const user of [a.waiter, waiter2, a.chef]) {
        const read = await user.client.from("order_line").select("id");
        expect(read.error).toBeNull();
        expect(read.data).toEqual([]);
      }
    });

    it("tenant B sees nothing of tenant A's session or lines and cannot change them", async () => {
      const line = lineOf((await view(a.waiter, s1)).body, stewLineId);
      expect((await view(b.waiter, s1)).status).toBe(404);
      expect((await addLine(b.waiter, s1, tap(bItemId))).status).toBe(404);
      expect(
        (await patchLine(b.waiter, line.id, { qty: 3, clientUpdatedAt: at(-100) })).status,
      ).toBe(404);
      expect((await removeLine(b.owner, line.id, { clientUpdatedAt: at(-100) })).status).toBe(404);
      // A's dish is not B's: adding it to B's own session is a menu_item_not_found.
      const foreign = await addLine(b.waiter, sb1, tap(fa.items.acqua));
      expect(foreign.status).toBe(404);
      expect(lineOf((await view(a.waiter, s1)).body, stewLineId)).toEqual(line);
    });

    it("tenant B's own order works, with its own dish and price", async () => {
      const added = await addLine(b.waiter, sb1, tap(bItemId));
      expect(added.status).toBe(201);
      expect(added.body.line.unitPrice).toBe(3);
    });

    it("a malformed id is a 404 before any database call", async () => {
      expect((await view(a.waiter, "x")).status).toBe(404);
      expect((await patchLine(a.waiter, "x", { qty: 2, clientUpdatedAt: at(-100) })).status).toBe(
        404,
      );
    });

    it("the chef's replies carry no euro sign and no cost key", () => {
      expect(chefTexts.length).toBeGreaterThan(0);
      for (const text of chefTexts) {
        expect(text).not.toContain("€");
        expect(keysOf(JSON.parse(text)).filter((key) => WAITER_FORBIDDEN.test(key))).toEqual([]);
      }
    });
  });
});
