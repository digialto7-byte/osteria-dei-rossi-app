import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { venueDate } from "@/lib/time/venue-date";
import type { PlatesResponse } from "@/server/costing/plates";
import type { AuditLog } from "@/server/audit/types";
import type { ManageMenu, MenuItem, ServiceMenu } from "@/server/menu/output";
import { serviceMenuOutput } from "@/server/menu/output";
import type { CopertoRead, DiningTable, TablesList, TableSession } from "@/server/tables/output";
import { openTableOutput, tablesListOutput } from "@/server/tables/output";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { PLATE, seedMenuTablesTenant, type MenuTablesFixture } from "./helpers/menu-tables";

// M17 acceptance tests 1 to 5 against the real local stack. The routes run for real (schemas, role checks, error
// mapping, the menu, table and session procedures, tables_list, the plate costs, RLS, append-only triggers); only
// `createSupabaseServerClient` is replaced, as in the M14 to M16 suites, so each call carries the signed-in test
// user's own client and two calls can be in flight together (AT2 opens one table twice at once). The secret key reads
// table_session, menu_item_price and the audit rows only to prove what was stored (select is granted to service_role
// on the five new tables); it never reads `recipe` or `recipe_key`, which it has no grant on. Fake data only.
//
// The tests run in order and share state. Tenant A: two locations, tables T1 to T3 (T4 is added later), a coperto of
// 1,50 EUR at 10 %, the sale VAT setting at its default 10, a second waiter. Tenant B: no coperto, sale VAT 22.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  return { createSupabaseServerClient: async () => asUser.store!.getStore() };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const recipesRoute = await import("@/app/api/recipes/route");
const meRoute = await import("@/app/api/me/route");
const settingsRoute = await import("@/app/api/settings/route");
const platesRoute = await import("@/app/api/costs/plates/route");
const auditRoute = await import("@/app/api/audit/route");
const menuRoute = await import("@/app/api/menu/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");
const menuItemRoute = await import("@/app/api/menu/[id]/route");
const tablesRoute = await import("@/app/api/tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const sessionRoute = await import("@/app/api/table-sessions/[id]/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const diningTableRoute = await import("@/app/api/dining-tables/[id]/route");
const copertoRoute = await import("@/app/api/settings/coperto/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
  error: { code: string; message: string; details?: { session?: TableSession } };
}

/** Property names at any depth of a JSON value. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];
// What a waiter may never see (AT4): costs, margins, GP, food cost, EUR-named values, recipe identity.
const WAITER_FORBIDDEN = /cost|margin|gp|food|eur$|recipe/i;

describe.skipIf(!env)("menu items, tables, sessions and coperto on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fa: MenuTablesFixture;
  let fb: MenuTablesFixture;
  let t1: string;
  let t2: string;
  let t3: string;
  let tb1: string;
  let waterId: string;
  let stewItemId: string;
  const nameOf = new Map<string, string>();

  // Every JSON text the chef received from an M17 route, scanned for euro signs at the end (project V6).
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
      if (user === a.chef) chefTexts.push(text);
      const body = JSON.parse(text) as T;
      return {
        status: response.status,
        body,
        text,
        error: (body as { error?: Reply["error"] }).error as Reply["error"],
      };
    });
  }

  const menu = (user: TestUser) => call<ServiceMenu>(user, menuRoute.GET as Handler, "/api/menu");
  const items = (user: TestUser) =>
    call<ManageMenu>(user, menuItemsRoute.GET as Handler, "/api/menu/items");
  const createItem = (user: TestUser, body: object) =>
    call<{ item: MenuItem }>(user, menuItemsRoute.POST as Handler, "/api/menu/items", {
      method: "POST",
      body,
    });
  const patchItem = (user: TestUser, id: string, body: object) =>
    call<{ changed: boolean; item: MenuItem }>(
      user,
      menuItemRoute.PATCH as Handler,
      `/api/menu/${id}`,
      { method: "PATCH", body, params: { id } },
    );
  const tables = (user: TestUser) =>
    call<TablesList>(user, tablesRoute.GET as Handler, "/api/tables");
  const open = (user: TestUser, tableId: string, sessionId: string, covers: number) =>
    call<{ created: boolean; session: TableSession }>(
      user,
      openRoute.POST as Handler,
      `/api/tables/${tableId}/open`,
      { method: "POST", body: { sessionId, covers }, params: { id: tableId } },
    );
  const patchSession = (user: TestUser, id: string, body: object) =>
    call<{ session: TableSession & { status: string } }>(
      user,
      sessionRoute.PATCH as Handler,
      `/api/table-sessions/${id}`,
      { method: "PATCH", body, params: { id } },
    );
  const diningTables = (user: TestUser) =>
    call<{ tables: DiningTable[] }>(user, diningTablesRoute.GET as Handler, "/api/dining-tables");
  const createTable = (user: TestUser, body: object) =>
    call<{ table: DiningTable }>(user, diningTablesRoute.POST as Handler, "/api/dining-tables", {
      method: "POST",
      body,
    });
  const patchTable = (user: TestUser, id: string, body: object) =>
    call<{ changed: boolean; table: DiningTable }>(
      user,
      diningTableRoute.PATCH as Handler,
      `/api/dining-tables/${id}`,
      { method: "PATCH", body, params: { id } },
    );
  const coperto = (user: TestUser) =>
    call<CopertoRead>(user, copertoRoute.GET as Handler, "/api/settings/coperto");
  const setCoperto = (user: TestUser, body: object) =>
    call<{ changed: boolean; coperto: { amount: number; vatRate: number } | null }>(
      user,
      copertoRoute.PATCH as Handler,
      "/api/settings/coperto",
      { method: "PATCH", body },
    );
  const plates = (user: TestUser) =>
    call<PlatesResponse>(user, platesRoute.GET as Handler, "/api/costs/plates");
  const plateOf = (body: PlatesResponse, key: string) =>
    body.plates.find((plate) => plate.recipeKey === key)!;
  const tileOf = (list: TablesList, id: string) => list.tables.find((table) => table.id === id)!;
  const itemOf = (list: ManageMenu, id: string) => list.items.find((item) => item.id === id)!;
  /** The number of open sessions of a table, read with the secret key (select is granted to service_role). */
  const openSessionsOf = async (tableId: string) => {
    const read = await stack.admin
      .from("table_session")
      .select("id")
      .eq("dining_table_id", tableId)
      .is("closed_at", null);
    expect(read.error).toBeNull();
    return (read.data ?? []).length;
  };

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    const recipesFor = (owner: TestUser) => ({
      createRecipe: (body: object) =>
        call(owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { recipe: { key: string } } }>,
    });
    fa = await seedMenuTablesTenant(stack, a, recipesFor(a.owner));
    fb = await seedMenuTablesTenant(stack, b, recipesFor(b.owner));

    // Two tenants whose implicit defaults differ (lesson 1): the sale VAT setting is 10 (default) and 22.
    const vat = await call(b.owner, settingsRoute.PATCH as Handler, "/api/settings", {
      method: "PATCH",
      body: { saleVatPct: 22 },
    });
    expect(vat.status).toBe(200);

    for (const user of [a.waiter, fa.waiter2, b.waiter]) {
      const me = await call<{ user: { displayName: string } }>(
        user,
        meRoute.GET as Handler,
        "/api/me",
      );
      nameOf.set(user.authId, me.body.user.displayName);
    }
  }, 240_000);

  describe("setup by the owner: tables, coperto, defaults", () => {
    it("the owner names the tables and each reply is the table", async () => {
      const ids: string[] = [];
      for (const [name, position] of [
        ["Tavolo 1 (demo)", 1],
        ["Tavolo 2 (demo)", 2],
        ["Tavolo 3 (demo)", 3],
      ] as const) {
        const made = await createTable(a.owner, { name, position });
        expect(made.status).toBe(201);
        expect(made.body.table).toMatchObject({ name, position, active: true, open: false });
        ids.push(made.body.table.id);
      }
      [t1, t2, t3] = ids as [string, string, string];
      const other = await createTable(b.owner, { name: "Tavolo 1 (demo)", position: 1 });
      expect(other.status).toBe(201);
      tb1 = other.body.table.id;
    });

    it("a table name is unique among active tables, whatever its case or spacing", async () => {
      const same = await createTable(a.owner, { name: " tavolo 1 (DEMO) " });
      expect([same.status, same.error.code]).toEqual([409, "table_name_taken"]);
      expect((await createTable(a.owner, { name: "" })).status).toBe(400);
    });

    it("the coperto is unset at first; the default VAT rate follows each tenant's own setting", async () => {
      const fresh = await coperto(a.owner);
      expect(fresh.status).toBe(200);
      expect(fresh.body.coperto).toBeNull();
      expect(fresh.body.defaults.vatRate).toBe(10);
      expect(fresh.body.vatRates).toEqual([0, 4, 5, 10, 22]);
      const other = await coperto(b.owner);
      expect(other.body.coperto).toBeNull();
      expect(other.body.defaults.vatRate).toBe(22);
    });

    it("AT3: the owner sets 1,50 EUR at 10 % for tenant A; one null is refused; tenant B has none", async () => {
      const half = await setCoperto(a.owner, { copertoAmount: 1.5, copertoVatRate: null });
      expect([half.status, half.error.code]).toEqual([422, "coperto_invalid"]);
      const set = await setCoperto(a.owner, { copertoAmount: 1.5, copertoVatRate: 10 });
      expect(set.status).toBe(200);
      expect(set.body).toEqual({ changed: true, coperto: { amount: 1.5, vatRate: 10 } });
      const again = await setCoperto(a.admin, { copertoAmount: 1.5, copertoVatRate: 10 });
      expect(again.body.changed).toBe(false);
      expect((await coperto(a.admin)).body.coperto).toEqual({ amount: 1.5, vatRate: 10 });
      expect((await coperto(b.owner)).body.coperto).toBeNull();
    });
  });

  describe("AT5: a menu item without a recipe is accepted and flagged unmapped", () => {
    it("margins before the menu: the plate keeps its recipe price 12,00 EUR and the sale VAT 10", async () => {
      const plate = plateOf((await plates(a.owner)).body, fa.plateKey);
      expect(plate).toMatchObject({ salePriceEur: 12, vatPct: 10 });
    });

    it("POST /api/menu/items without a recipe is a 201, listed as unmapped with its price", async () => {
      const made = await createItem(a.owner, {
        name: "Acqua (demo)",
        category: "Bevande",
        course: "bevande",
        recipeKey: null,
        price: 2,
        vatRate: 10,
        position: 1,
      });
      expect(made.status).toBe(201);
      waterId = made.body.item.id;
      expect(made.body.item).toMatchObject({
        name: "Acqua (demo)",
        recipeKey: null,
        recipeName: null,
        unmapped: true,
        price: 2,
        vatRate: 10,
        available: true,
        active: true,
        pushUntil: null,
        pushPrice: null,
      });
      const listed = itemOf((await items(a.owner)).body, waterId);
      expect(listed).toMatchObject({ unmapped: true, category: "Bevande", course: "bevande" });
    });

    it("a mapped item (the plate at 14,00 EUR, VAT 22) is not unmapped and shows the recipe name", async () => {
      const made = await createItem(a.admin, {
        name: PLATE,
        category: "Secondi",
        course: "secondi",
        recipeKey: fa.plateKey,
        price: 14,
        vatRate: 22,
      });
      expect(made.status).toBe(201);
      stewItemId = made.body.item.id;
      expect(made.body.item).toMatchObject({
        unmapped: false,
        recipeKey: fa.plateKey,
        recipeName: PLATE,
        recipeActive: true,
        price: 14,
        vatRate: 22,
        position: 0,
      });
    });

    it("the manage list: defaults per tenant, the form data, active first then by position", async () => {
      const list = (await items(a.owner)).body;
      expect(list.defaults.vatRate).toBe(10);
      expect(list.vatRates).toEqual([0, 4, 5, 10, 22]);
      expect(list.courses).toEqual(["antipasti", "primi", "secondi", "dolci", "bevande"]);
      expect(list.categories).toEqual(["Bevande", "Secondi"]);
      expect(list.items.map((item) => item.id)).toEqual([stewItemId, waterId]);
      expect((await items(b.owner)).body.defaults.vatRate).toBe(22);
    });

    it("refuses a repeated name, a recipe already on the menu, an unknown recipe and bad values", async () => {
      const base = {
        name: "Altro (demo)",
        category: "Secondi",
        course: "secondi",
        recipeKey: null,
        price: 5,
        vatRate: 10,
      };
      const name = await createItem(a.owner, { ...base, name: " acqua (DEMO) " });
      expect([name.status, name.error.code]).toEqual([409, "menu_item_name_taken"]);
      const twice = await createItem(a.owner, { ...base, recipeKey: fa.plateKey });
      expect([twice.status, twice.error.code]).toEqual([409, "recipe_already_on_menu"]);
      const unknown = await createItem(a.owner, { ...base, recipeKey: randomUUID() });
      expect([unknown.status, unknown.error.code]).toEqual([404, "not_found"]);
      // Another tenant's plate key is as unknown as a random one (no existence leak).
      const foreign = await createItem(a.owner, { ...base, recipeKey: fb.plateKey });
      expect([foreign.status, foreign.error.code]).toEqual([404, "not_found"]);
      expect((await createItem(a.owner, { ...base, price: 2.005 })).status).toBe(400);
      expect((await createItem(a.owner, { ...base, vatRate: undefined })).status).toBe(400);
      expect((await createItem(a.owner, { ...base, pushUntil: null })).status).toBe(400);
    });

    it("a price change keeps the history: 14,00 to 15,00 writes a second price row and one audit event", async () => {
      const changed = await patchItem(a.owner, stewItemId, { price: 15 });
      expect(changed.status).toBe(200);
      expect(changed.body.changed).toBe(true);
      expect(changed.body.item.price).toBe(15);
      const same = await patchItem(a.owner, stewItemId, { price: 15 });
      expect(same.body.changed).toBe(false);
      const rows = await stack.admin
        .from("menu_item_price")
        .select("price, vat_rate")
        .eq("menu_item_id", stewItemId)
        .order("valid_from");
      expect(rows.error).toBeNull();
      expect((rows.data ?? []).map((row) => Number(row.price))).toEqual([14, 15]);
      expect((rows.data ?? []).map((row) => Number(row.vat_rate))).toEqual([22, 22]);
    });

    it("the margins now use the menu price and its VAT; deactivating the item restores the recipe's", async () => {
      expect(plateOf((await plates(a.owner)).body, fa.plateKey)).toMatchObject({
        salePriceEur: 15,
        vatPct: 22,
      });
      expect((await patchItem(a.owner, stewItemId, { active: false })).body.item.active).toBe(
        false,
      );
      expect(plateOf((await plates(a.owner)).body, fa.plateKey)).toMatchObject({
        salePriceEur: 12,
        vatPct: 10,
      });
      expect((await patchItem(a.owner, stewItemId, { active: true })).status).toBe(200);
      expect(plateOf((await plates(a.owner)).body, fa.plateKey).salePriceEur).toBe(15);
    });

    it("the changes are in the activity log with their own words and no cost", async () => {
      const today = venueDate(new Date());
      const log = await call<AuditLog>(
        a.owner,
        auditRoute.GET as Handler,
        `/api/audit?kind=events&from=${today}&to=${today}`,
      );
      expect(log.status).toBe(200);
      const actions = log.body.entries.map((entry) => entry.action);
      for (const action of [
        "menu_item.created",
        "menu_item.updated",
        "dining_table.created",
        "sale_settings.changed",
      ]) {
        expect(actions, action).toContain(action);
      }
    });
  });

  describe("AT4: the waiter's menu and tables carry no cost or margin", () => {
    it("GET /api/menu validates against the strict schema; the waiter reads sale prices only", async () => {
      const reply = await menu(a.waiter);
      expect(reply.status).toBe(200);
      expect(serviceMenuOutput.safeParse(reply.body).success).toBe(true);
      expect(keysOf(reply.body).filter((key) => WAITER_FORBIDDEN.test(key))).toEqual([]);
      const ids = reply.body.categories.flatMap((c) => c.items.map((item) => item.id));
      expect(ids.sort()).toEqual([stewItemId, waterId].sort());
      const stew = reply.body.categories.flatMap((c) => c.items).find((i) => i.id === stewItemId)!;
      expect(stew).toMatchObject({ price: 15, available: true, pushed: false, pushPrice: null });
      expect(reply.body.categories.map((c) => c.name)).toEqual(["Secondi", "Bevande"]);
    });

    it("the menu is the same shape for the owner and the admin (one cacheable shape)", async () => {
      const waiter = (await menu(a.waiter)).body;
      expect((await menu(a.owner)).body).toEqual(waiter);
      expect((await menu(a.admin)).body).toEqual(waiter);
    });

    it("an inactive item leaves the waiter's menu and comes back", async () => {
      expect((await patchItem(a.owner, waterId, { active: false })).status).toBe(200);
      const without = (await menu(a.waiter)).body.categories.flatMap((c) =>
        c.items.map((i) => i.id),
      );
      expect(without).toEqual([stewItemId]);
      expect((await patchItem(a.owner, waterId, { active: true })).status).toBe(200);
      expect((await menu(a.waiter)).body.categories.flatMap((c) => c.items)).toHaveLength(2);
    });

    it("the waiter and the chef read nothing directly from the five tables (RLS: 0 rows)", async () => {
      for (const user of [a.waiter, a.chef, fa.waiter2]) {
        for (const table of [
          "menu_item",
          "menu_item_price",
          "dining_table",
          "table_session",
          "sale_settings",
        ]) {
          const read = await user.client.from(table).select("id");
          expect(read.error, `${user.role} ${table}`).toBeNull();
          expect(read.data, `${user.role} ${table}`).toEqual([]);
        }
      }
    });

    it("no API role can write the tables directly (the procedures are the only way in)", async () => {
      const insert = await a.owner.client
        .from("menu_item")
        .insert({ name: "Diretto (demo)", category: "X", course_default: "primi" });
      expect(insert.error).not.toBeNull();
      const update = await a.owner.client.from("dining_table").update({ name: "X" }).eq("id", t1);
      expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
    });
  });

  describe("AT2 and AT3: opening a table", () => {
    const s1 = randomUUID();
    const s2 = randomUUID();

    it("waiter A opens T1 with 4 covers: 201, the coperto is 4 x 1,50 = 6,00 EUR at 10 %", async () => {
      const opened = await open(a.waiter, t1, s1, 4);
      expect(opened.status).toBe(201);
      expect(openTableOutput.safeParse(opened.body).success).toBe(true);
      expect(opened.body.created).toBe(true);
      expect(opened.body.session).toMatchObject({
        id: s1,
        tableId: t1,
        tableName: "Tavolo 1 (demo)",
        covers: 4,
        billRequested: false,
        coperto: { perPerson: 1.5, vatRate: 10, total: 6 },
        waiter: { id: expect.any(String), displayName: nameOf.get(a.waiter.authId) },
      });
      expect(opened.body.session.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("AT2: waiter B opens T1 with a new id: 409 table_already_open naming waiter A", async () => {
      const second = await open(fa.waiter2, t1, s2, 2);
      expect(second.status).toBe(409);
      expect(second.error.code).toBe("table_already_open");
      expect(second.error.details?.session).toMatchObject({ id: s1, covers: 4, tableId: t1 });
      expect(second.error.details?.session?.waiter.displayName).toBe(nameOf.get(a.waiter.authId));
      expect(second.error.message).toContain(nameOf.get(a.waiter.authId)!);
      expect(await openSessionsOf(t1)).toBe(1);
    });

    it("the same request again is a replay: 200, created false, still one session", async () => {
      const replay = await open(a.waiter, t1, s1, 4);
      expect(replay.status).toBe(200);
      expect(replay.body.created).toBe(false);
      expect(replay.body.session.id).toBe(s1);
      expect(await openSessionsOf(t1)).toBe(1);
    });

    it("a session id is not reusable on another table or another tenant's: 409 session_id_conflict", async () => {
      const other = await open(a.waiter, t2, s1, 2);
      expect([other.status, other.error.code]).toEqual([409, "session_id_conflict"]);
      expect(other.error.details).toBeUndefined();
      const foreign = await open(b.waiter, tb1, s1, 2);
      expect([foreign.status, foreign.error.code]).toEqual([409, "session_id_conflict"]);
      expect(foreign.error.details).toBeUndefined();
      expect(await openSessionsOf(t2)).toBe(0);
    });

    it("two concurrent openings of T2 with different ids: exactly one 201 and one 409, one open session", async () => {
      const [first, second] = await Promise.all([
        open(a.waiter, t2, randomUUID(), 2),
        open(fa.waiter2, t2, randomUUID(), 3),
      ]);
      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const loser = first.status === 409 ? first : second;
      expect(loser.error.code).toBe("table_already_open");
      expect(loser.error.details?.session?.tableId).toBe(t2);
      expect(await openSessionsOf(t2)).toBe(1);
    });

    it("refuses covers outside 1 to 99, an unknown table and a table of another tenant", async () => {
      expect((await open(a.waiter, t3, randomUUID(), 0)).status).toBe(400);
      expect((await open(a.waiter, t3, randomUUID(), 100)).status).toBe(400);
      const missing = await open(a.waiter, randomUUID(), randomUUID(), 2);
      expect([missing.status, missing.error.code]).toEqual([404, "not_found"]);
      const foreign = await open(a.waiter, tb1, randomUUID(), 2);
      expect([foreign.status, foreign.error.code]).toEqual([404, "not_found"]);
      expect(await openSessionsOf(t3)).toBe(0);
    });

    it("AT3: tenant B has no coperto, so its table opens with coperto null", async () => {
      const opened = await open(b.waiter, tb1, randomUUID(), 3);
      expect(opened.status).toBe(201);
      expect(opened.body.session.coperto).toBeNull();
      const tile = tileOf((await tables(b.waiter)).body, tb1);
      expect(tile.session?.coperto).toBeNull();
    });

    it("AT3: a later change of the coperto never touches a table already open", async () => {
      expect((await setCoperto(a.owner, { copertoAmount: 2, copertoVatRate: 22 })).status).toBe(
        200,
      );
      const tile = tileOf((await tables(a.waiter)).body, t1);
      expect(tile.session?.coperto).toEqual({ perPerson: 1.5, vatRate: 10, total: 6 });
      // A table opened now takes the new amount.
      const opened = await open(a.waiter, t3, randomUUID(), 3);
      expect(opened.body.session.coperto).toEqual({ perPerson: 2, vatRate: 22, total: 6 });
      expect((await setCoperto(a.owner, { copertoAmount: 1.5, copertoVatRate: 10 })).status).toBe(
        200,
      );
    });
  });

  describe("AT1: the status of a table, and several waiters on one table", () => {
    it("T1 is open with waiter A, T2 and T3 are open, and the list is in table order", async () => {
      const list = (await tables(a.waiter)).body;
      expect(tablesListOutput.safeParse(list).success).toBe(true);
      expect(list.tables.map((table) => table.id)).toEqual([t1, t2, t3]);
      expect(tileOf(list, t1)).toMatchObject({
        name: "Tavolo 1 (demo)",
        status: "open",
        session: {
          covers: 4,
          openedToday: true,
          billRequested: false,
          waiter: { displayName: nameOf.get(a.waiter.authId) },
        },
      });
      expect(list.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("waiter B changes the covers of A's table: 5 covers, the frozen 1,50 EUR gives 7,50; the opener stays A", async () => {
      const first = (await tables(a.waiter)).body;
      const sessionId = tileOf(first, t1).session!.id;
      const changed = await patchSession(fa.waiter2, sessionId, { covers: 5 });
      expect(changed.status).toBe(200);
      expect(changed.body.session).toMatchObject({
        covers: 5,
        status: "open",
        coperto: { perPerson: 1.5, vatRate: 10, total: 7.5 },
        waiter: { displayName: nameOf.get(a.waiter.authId) },
      });
      expect((await patchSession(fa.waiter2, sessionId, { covers: 0 })).status).toBe(400);
    });

    it("waiter B requests the bill: T1 shows bill_requested for waiter A as well; T3 stays open", async () => {
      const sessionId = tileOf((await tables(a.waiter)).body, t1).session!.id;
      const asked = await patchSession(fa.waiter2, sessionId, { billRequested: true });
      expect(asked.status).toBe(200);
      expect(asked.body.session.status).toBe("bill_requested");
      const list = (await tables(a.waiter)).body;
      expect(tileOf(list, t1)).toMatchObject({
        status: "bill_requested",
        session: {
          billRequested: true,
          covers: 5,
          waiter: { displayName: nameOf.get(a.waiter.authId) },
        },
      });
      expect(tileOf(list, t3).status).toBe("open");
      const cleared = await patchSession(a.waiter, sessionId, { billRequested: false });
      expect(cleared.body.session.status).toBe("open");
      expect((await patchSession(a.waiter, sessionId, { billRequested: true })).status).toBe(200);
    });

    it("a table with no session is free; a session of another tenant is a 404 to everyone else", async () => {
      const made = await createTable(a.owner, { name: "Tavolo 4 (demo)", position: 4 });
      const free = tileOf((await tables(a.waiter)).body, made.body.table.id);
      expect(free).toMatchObject({ status: "free", session: null });
      const sessionId = tileOf((await tables(a.waiter)).body, t1).session!.id;
      const foreign = await patchSession(b.waiter, sessionId, { covers: 2 });
      expect([foreign.status, foreign.error.code]).toEqual([404, "not_found"]);
    });

    it("lesson 1: adding a third location changes nothing that M17 returns", async () => {
      const before = { tables: (await tables(a.waiter)).body, menu: (await menu(a.waiter)).body };
      const added = await stack.admin
        .from("location")
        .insert({ tenant_id: a.id, name: "Mensa (demo)" });
      expect(added.error).toBeNull();
      expect({ tables: (await tables(a.waiter)).body, menu: (await menu(a.waiter)).body }).toEqual(
        before,
      );
      expect(fa.cellaId).not.toBe(fa.dispensaId);
    });
  });

  describe("tables: renaming, order and deactivation", () => {
    it("renaming applies to the next opening only (the session keeps its name); a taken name is a 409", async () => {
      const renamed = await patchTable(a.owner, t1, { name: "Tavolo uno (demo)", position: 1 });
      expect(renamed.status).toBe(200);
      expect(renamed.body.changed).toBe(true);
      const tile = tileOf((await tables(a.waiter)).body, t1);
      expect(tile.name).toBe("Tavolo uno (demo)");
      const clash = await patchTable(a.owner, t2, { name: "tavolo UNO (demo)" });
      expect([clash.status, clash.error.code]).toEqual([409, "table_name_taken"]);
      const unchanged = await patchTable(a.owner, t1, { name: "Tavolo uno (demo)" });
      expect(unchanged.body.changed).toBe(false);
      const stored = await stack.admin
        .from("table_session")
        .select("table_name")
        .eq("dining_table_id", t1);
      expect((stored.data ?? []).map((row) => row.table_name)).toEqual(["Tavolo 1 (demo)"]);
    });

    it("a table with an open session cannot be deactivated: 409 table_open; a free one can, and leaves the list", async () => {
      const busy = await patchTable(a.owner, t1, { active: false });
      expect([busy.status, busy.error.code]).toEqual([409, "table_open"]);
      expect(busy.error.message).toBe("Chiudi prima il tavolo aperto.");
      const spare = (await diningTables(a.owner)).body.tables.find(
        (t) => t.name === "Tavolo 4 (demo)",
      )!;
      expect(spare.open).toBe(false);
      expect((await patchTable(a.owner, spare.id, { active: false })).status).toBe(200);
      const list = (await tables(a.waiter)).body;
      expect(list.tables.map((t) => t.id)).not.toContain(spare.id);
      const manage = (await diningTables(a.admin)).body.tables;
      expect(manage.find((t) => t.id === spare.id)).toMatchObject({ active: false, open: false });
      expect(manage.find((t) => t.id === t1)).toMatchObject({ active: true, open: true });
    });
  });

  describe("roles and tenancy", () => {
    it("the chef gets 403 on the menu, the tables and the opening, and never receives a euro sign", async () => {
      expect((await menu(a.chef)).status).toBe(403);
      expect((await tables(a.chef)).status).toBe(403);
      expect((await open(a.chef, t3, randomUUID(), 2)).status).toBe(403);
      expect((await patchSession(a.chef, randomUUID(), { covers: 2 })).status).toBe(403);
      expect((await items(a.chef)).status).toBe(403);
      expect((await coperto(a.chef)).status).toBe(403);
      for (const text of chefTexts) expect(text).not.toContain("€");
    });

    it("the waiter gets 403 on every management route", async () => {
      expect((await items(a.waiter)).status).toBe(403);
      expect(
        (
          await createItem(a.waiter, {
            name: "X",
            category: "X",
            course: "primi",
            recipeKey: null,
            price: 1,
            vatRate: 10,
          })
        ).status,
      ).toBe(403);
      expect((await patchItem(a.waiter, waterId, { price: 1 })).status).toBe(403);
      expect((await diningTables(a.waiter)).status).toBe(403);
      expect((await createTable(a.waiter, { name: "X" })).status).toBe(403);
      expect((await patchTable(a.waiter, t1, { active: false })).status).toBe(403);
      expect((await coperto(a.waiter)).status).toBe(403);
      expect(
        (await setCoperto(a.waiter, { copertoAmount: null, copertoVatRate: null })).status,
      ).toBe(403);
      // Nothing was changed by the refused calls.
      expect(itemOf((await items(a.owner)).body, waterId).price).toBe(2);
      expect((await coperto(a.owner)).body.coperto).toEqual({ amount: 1.5, vatRate: 10 });
    });

    it("tenant B sees none of tenant A's items, tables or sessions, and cannot change them", async () => {
      const bItems = (await items(b.owner)).body.items;
      expect(bItems).toEqual([]);
      expect((await menu(b.waiter)).body.categories).toEqual([]);
      const bTables = (await diningTables(b.owner)).body.tables;
      expect(bTables.map((t) => t.id)).toEqual([tb1]);
      expect((await tables(b.waiter)).body.tables.map((t) => t.id)).toEqual([tb1]);
      const rename = await patchTable(b.owner, t1, { name: "Rubato (demo)" });
      expect([rename.status, rename.error.code]).toEqual([404, "not_found"]);
      const price = await patchItem(b.owner, stewItemId, { price: 1 });
      expect([price.status, price.error.code]).toEqual([404, "not_found"]);
      expect(itemOf((await items(a.owner)).body, stewItemId).price).toBe(15);
    });

    it("the owner and the admin of a tenant read the same items", async () => {
      expect((await items(a.admin)).body).toEqual((await items(a.owner)).body);
    });
  });
});
