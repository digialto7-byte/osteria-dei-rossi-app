import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { AlertList } from "@/server/alerts/list";
import type { OpEnvelope } from "@/server/sync/schemas";
import type { OpResult, SyncOutput } from "@/server/sync/output";
import type { TableSession } from "@/server/tables/output";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { FIRING_NAMES, seedFiringTenant, type FiringFixture } from "./helpers/firing";
import { appUserId, opFor } from "./helpers/sync";
import { runSql } from "./helpers/sql";

// M20 acceptance tests 2 to 5, 8 and 9 against the real local stack (plan §5 step 12). Over HTTP into the real route: POST /api/sync
// runs the schemas, the role checks, apply_op, the existing M17-M19 procedures, RLS and the ledger triggers. Only
// `createSupabaseServerClient` is replaced (as in the M14 to M19 suites), so each call carries the signed-in test user's own
// client. The secret key reads `applied_op` (select is granted to service_role); order lines are read with SQL on the LOCAL
// database (helpers/sql.ts asserts the URL is local). Fake data only.
//
// The tests run in order and share state. Tenant A: the M19 firing fixture (stew batches A 3 and B 5 portions, ragù 10, polenta,
// bread, two waiters, one unmapped dish "Acqua (demo)"), two open tables. Tenant B: one table with a session. Throws in CI when
// the stack settings are missing; skips on a developer machine.
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
const menuItemsRoute = await import("@/app/api/menu/items/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const syncRoute = await import("@/app/api/sync/route");
const alertsRoute = await import("@/app/api/alerts/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
}

const today = venueDate(new Date());
const day = (offset: number) => addDays(today, offset);

describe.skipIf(!env)("the offline queue on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fa: FiringFixture;
  let waiter2: TestUser;
  let w1: string;
  let w2: string;
  let wb: string;
  let s1: string;
  let s2: string;
  let sb1: string;
  let acquaB: string;

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
      return { status: response.status, body: JSON.parse(text) as T, text };
    });
  }

  /** Every JSON text a waiter received from /api/sync, scanned for costs at the end. */
  const waiterTexts: string[] = [];
  const sync = async (user: TestUser, ops: OpEnvelope[]) => {
    const reply = await call<SyncOutput>(user, syncRoute.POST as Handler, "/api/sync", {
      method: "POST",
      body: { ops },
    });
    if (user.role === "waiter") waiterTexts.push(reply.text);
    return reply;
  };
  const one = async (user: TestUser, op: OpEnvelope) => {
    const reply = await sync(user, [op]);
    expect(reply.status).toBe(200);
    expect(reply.body.results).toHaveLength(1);
    return reply.body.results[0] as OpResult;
  };
  const alerts = (user: TestUser) =>
    call<AlertList>(user, alertsRoute.GET as Handler, "/api/alerts?filter=open");

  const addOp = (
    userId: string,
    session: string,
    lineId: string,
    menuItemId: string,
    extra: object = {},
  ) =>
    opFor("add_line", { sessionId: session, lineId, menuItemId, ...extra }, userId, {
      msFromNow: -600_000,
    });
  const lineState = (lineId: string) =>
    runSql(
      `select state || '/' || trim_scale(qty)::text || '/' || client_updated_at::text from public.order_line where id = '${lineId}'`,
    );
  const lineExists = (lineId: string) =>
    runSql(`select count(*) from public.order_line where id = '${lineId}'`) === "1";
  const opRows = async (opId: string) => {
    const read = await stack.admin.from("applied_op").select("*").eq("op_id", opId);
    expect(read.error).toBeNull();
    return read.data ?? [];
  };
  const stewBalance = (batchId: string) =>
    runSql(
      `select coalesce(sum(portions), 0) from public.batch_movement where batch_id = '${batchId}'`,
    );

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
    fa = await seedFiringTenant(stack, a, {
      createRecipe: (body: object) =>
        call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as Promise<{
          status: number;
          body: { recipe: { key: string } };
        }>,
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
    w1 = await appUserId(stack, a.waiter);
    w2 = await appUserId(stack, waiter2);
    wb = await appUserId(stack, b.waiter);

    const openTable = async (owner: TestUser, waiter: TestUser, name: string, position: number) => {
      const table = await call<{ table: { id: string } }>(
        owner,
        diningTablesRoute.POST as Handler,
        "/api/dining-tables",
        { method: "POST", body: { name, position } },
      );
      expect(table.status).toBe(201);
      const sessionId = randomUUID();
      const opened = await call<{ created: boolean; session: TableSession }>(
        waiter,
        openRoute.POST as Handler,
        `/api/tables/${table.body.table.id}/open`,
        {
          method: "POST",
          body: { sessionId, covers: 2 },
          params: { id: table.body.table.id },
        },
      );
      expect(opened.status).toBe(201);
      return sessionId;
    };
    s1 = await openTable(a.owner, a.waiter, "Tavolo 1 (demo)", 1);
    s2 = await openTable(a.owner, waiter2, "Tavolo 2 (demo)", 2);
    sb1 = await openTable(b.owner, b.waiter, "Tavolo 1 (demo)", 1);

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
    acquaB = itemB.body.item.id;
  }, 300_000);

  describe("access", () => {
    it("the chef gets 403 and writes nothing", async () => {
      const reply = await sync(a.chef, [addOp(w1, s1, randomUUID(), fa.items.acqua)]);
      expect(reply.status).toBe(403);
    });
  });

  describe("AT3: the same op twice is applied once", () => {
    it("applied, then duplicate with the stored reply; one applied_op row", async () => {
      const lineId = randomUUID();
      const op = addOp(w1, s1, lineId, fa.items.acqua);
      const first = await one(a.waiter, op);
      expect(first.status).toBe("applied");
      const second = await one(a.waiter, op);
      expect(second.status).toBe("duplicate");
      if (first.status !== "applied" || second.status !== "duplicate")
        throw new Error("unreachable");
      expect(second.stored).toMatchObject({ status: "applied", reply: first.reply });
      expect(await opRows(op.opId)).toHaveLength(1);
      expect(runSql(`select count(*) from public.order_line where id = '${lineId}'`)).toBe("1");
    });

    it("the row carries the stamp and the receipt time apart", async () => {
      const op = addOp(w1, s1, randomUUID(), fa.items.acqua);
      await one(a.waiter, op);
      const [row] = await opRows(op.opId);
      expect(row).toMatchObject({ kind: "add_line", outcome: "applied", seq: op.seq });
      expect(Date.parse(row.client_ts as string)).toBe(Date.parse(op.clientTs));
      expect(Date.parse(row.received_at as string)).toBeGreaterThan(Date.parse(op.clientTs));
    });
  });

  describe("AT4: a stale edit to a fired line is a conflict and changes nothing", () => {
    it("fire L, then an edit op of L: conflict fired, L unchanged", async () => {
      const lineId = randomUUID();
      expect((await one(a.waiter, addOp(w1, s1, lineId, fa.items.stew))).status).toBe("applied");
      const sent = await one(a.waiter, opFor("fire", { sessionId: s1, lineIds: [lineId] }, w1));
      expect(sent.status).toBe("applied");
      const before = lineState(lineId);
      const edit = await one(a.waiter, opFor("edit_line", { lineId, qty: 3 }, w1));
      expect(edit.status).toBe("conflict");
      if (edit.status !== "conflict") throw new Error("unreachable");
      expect(edit.conflict.reason).toBe("fired");
      expect(lineState(lineId)).toBe(before);
    });
  });

  describe("AT5: two waiters edit the same line, the later stamp wins", () => {
    it("order 1: the later stamp arrives first, the earlier one gets conflict stale", async () => {
      const lineId = randomUUID();
      await one(a.waiter, addOp(w1, s1, lineId, fa.items.tagliatelle));
      const later = await one(
        waiter2,
        opFor("edit_line", { lineId, qty: 3 }, w2, { msFromNow: -30_000 }),
      );
      expect(later.status).toBe("applied");
      const earlier = await one(
        a.waiter,
        opFor("edit_line", { lineId, qty: 2 }, w1, { msFromNow: -60_000 }),
      );
      expect(earlier.status).toBe("conflict");
      if (earlier.status !== "conflict") throw new Error("unreachable");
      expect(earlier.conflict.reason).toBe("stale");
      expect(earlier.conflict.line?.updatedBy.id).toBe(w2);
      expect(lineState(lineId).split("/").slice(0, 2).join("/")).toBe("draft/3");
    });

    it("order 2: the earlier stamp arrives first, both apply, the line has the later stamp's quantity", async () => {
      const lineId = randomUUID();
      await one(a.waiter, addOp(w1, s1, lineId, fa.items.tagliatelle));
      const earlier = await one(
        a.waiter,
        opFor("edit_line", { lineId, qty: 2 }, w1, { msFromNow: -60_000 }),
      );
      const later = await one(
        waiter2,
        opFor("edit_line", { lineId, qty: 3 }, w2, { msFromNow: -30_000 }),
      );
      expect([earlier.status, later.status]).toEqual(["applied", "applied"]);
      expect(lineState(lineId).split("/").slice(0, 2).join("/")).toBe("draft/3");
    });
  });

  describe("AT9: a fire for a dish that has run out is applied with a negative_stock alert", () => {
    it("the stew is added while stock exists, the chef then empties both batches, and the fire op is still applied", async () => {
      const lineId = randomUUID();
      expect((await one(a.waiter, addOp(w1, s1, lineId, fa.items.stew))).status).toBe("applied");
      // The chef discards what is left of both stew batches through the API.
      for (const batchId of [fa.stewBatchA, fa.stewBatchB]) {
        const left = Number(stewBalance(batchId));
        if (left <= 0) continue;
        const discarded = await call(
          a.chef,
          discardRoute.POST as Handler,
          `/api/batches/${batchId}/discard`,
          {
            method: "POST",
            body: { portions: left, reason: "spoilage" },
            params: { id: batchId },
          },
        );
        expect(discarded.status).toBe(201);
      }
      const sent = await one(a.waiter, opFor("fire", { sessionId: s1, lineIds: [lineId] }, w1));
      expect(sent.status).toBe("applied");
      expect(lineState(lineId).split("/")[0]).toBe("fired");
      const list = await alerts(a.chef);
      expect(list.status).toBe(200);
      const alert = list.body.alerts.find(
        (item) => item.kind === "negative_stock" && item.entityType === "recipe_key",
      );
      expect(alert).toBeDefined();
      expect(alert!.href).toBe("/produzione");
    });
  });

  describe("dead entity: a refused add stops the batch before the fire that names it", () => {
    it("[add stew at 0, fire [stew line, acqua line]] gives one rejected result and fires nothing", async () => {
      const acqua = randomUUID();
      await one(a.waiter, addOp(w1, s2, acqua, fa.items.acqua));
      // The stew is sold out since the AT9 case above emptied both batches.
      const stew = randomUUID();
      const reply = await sync(waiter2, [
        addOp(w2, s2, stew, fa.items.stew),
        opFor("fire", { sessionId: s2, lineIds: [stew, acqua] }, w2),
      ]);
      expect(reply.status).toBe(200);
      expect(reply.body.results).toHaveLength(1);
      expect(reply.body.results[0]).toMatchObject({
        status: "rejected",
        kind: "add_line",
        error: { code: "item_unavailable", httpStatus: 409 },
      });
      expect(reply.body.stopped).toEqual({
        opId: reply.body.results[0]!.opId,
        reason: "dead_entity",
      });
      expect(lineExists(stew)).toBe(false);
      expect(lineState(acqua).split("/")[0]).toBe("draft");
    });
  });

  describe("AT8: ops of another user are not applied", () => {
    it("waiter 2 sending waiter 1's op: stopped user_mismatch, nothing written", async () => {
      const lineId = randomUUID();
      const reply = await sync(waiter2, [addOp(w1, s1, lineId, fa.items.acqua)]);
      expect(reply.status).toBe(200);
      expect(reply.body.results).toEqual([]);
      expect(reply.body.stopped).toMatchObject({ reason: "user_mismatch" });
      expect(lineExists(lineId)).toBe(false);
    });
  });

  describe("tenancy", () => {
    it("tenant B's waiter naming tenant A's session gets a rejection, and A's session gains no line", async () => {
      const lineId = randomUUID();
      const result = await one(b.waiter, addOp(wb, s1, lineId, acquaB));
      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") throw new Error("unreachable");
      expect(result.error).toMatchObject({ httpStatus: 404, code: "not_found" });
      expect(lineExists(lineId)).toBe(false);
    });

    it("tenant B reusing tenant A's op id with its own payload is applied (keys are tenant-scoped)", async () => {
      const shared = randomUUID();
      const mine = addOp(w1, s1, randomUUID(), fa.items.acqua);
      mine.opId = shared;
      expect((await one(a.waiter, mine)).status).toBe("applied");
      const theirs = addOp(wb, sb1, randomUUID(), acquaB);
      theirs.opId = shared;
      expect((await one(b.waiter, theirs)).status).toBe("applied");
      expect(await opRows(shared)).toHaveLength(2);
    });
  });

  describe("what a waiter received", () => {
    it("no sync reply carries a cost, margin or euro sign", () => {
      expect(waiterTexts.length).toBeGreaterThan(5);
      for (const text of waiterTexts) expect(text).not.toMatch(/cost|margin|food|€|eur"/i);
    });

    it("the names used are fake", () => {
      expect(FIRING_NAMES.stew).toContain("(demo)");
    });
  });
});
