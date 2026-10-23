import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { romeDate, waitPastRomeMidnight } from "../helpers/rome-midnight";
import type { AlertItem, AlertList } from "@/server/alerts/list";
import { ALERT_KINDS } from "@/server/alerts/kinds";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M6 acceptance tests 1, 3, 4 and 6 against the real local stack, plus the job_run helpers and the
// parity of the SQL and TypeScript alert kind registries. The alert routes run for real (role check,
// schemas, error mapping, acknowledge_alert / raise_test_alert, RLS, the alert_guard trigger); only
// `createSupabaseServerClient` is replaced, because it would read cookies from a Next.js request: each
// call is handed the signed-in test user's own client (publishable key + that user's JWT).
// Stored rows are read through the owner of the tenant (the secret key has no grant on `alert` by design).
//
// The tests run in order and share state: tenant A holds the test alert and the kitchen test alert
// (AT1, AT6, AT4); tenant B holds one test alert that is used for the "stays visible until
// acknowledged" case (AT3). Both tenants are created fresh, so the counts start at zero. Dedup is per
// Europe/Rome business date, so a run that straddled 00:00 there would make two rows: beforeAll waits
// past midnight when it is under 2 minutes away, and the dedup cases assert the date did not change.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const listRoute = await import("@/app/api/alerts/route");
const ackRoute = await import("@/app/api/alerts/[id]/ack/route");
const testRoute = await import("@/app/api/alerts/test/route");

const NO_ID = "00000000-0000-4000-8000-000000000000";

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  error: { code: string; message: string };
}

/** One request to a real route handler, as the given user. */
async function call<T = Record<string, unknown>>(
  user: TestUser,
  handler: Handler,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<Reply<T>> {
  session.client = user.client;
  const method = init.method ?? "GET";
  const response = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { params: Promise.resolve(init.params ?? {}) },
  );
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
    error: (body as { error?: Reply["error"] }).error as Reply["error"],
  };
}

const list = (user: TestUser, query = "") =>
  call<AlertList>(user, listRoute.GET as Handler, `/api/alerts${query}`);
const raise = (user: TestUser, body: unknown = {}) =>
  call<{ alert: AlertItem; deduplicated: boolean }>(
    user,
    testRoute.POST as Handler,
    "/api/alerts/test",
    {
      method: "POST",
      body,
    },
  );
const acknowledge = (user: TestUser, id: string) =>
  call<{ alert: AlertItem }>(user, ackRoute.POST as Handler, `/api/alerts/${id}/ack`, {
    method: "POST",
    body: {},
    params: { id },
  });

describe.skipIf(!env)("alerts on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let plainId: string;
  let kitchenId: string;
  let otherTenantAlertId: string;

  /**
   * The alerts of a tenant, read through its owner's session: the owner reads every alert of the
   * tenant, and the secret key has no grant on `alert` by design (service_role reads nothing).
   */
  const storedAlerts = async (tenant: TestTenant, kind?: string) => {
    let query = tenant.owner.client
      .from("alert")
      .select("id, kind, acknowledged_at, acknowledged_by")
      .eq("tenant_id", tenant.id);
    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query;
    if (error) throw new Error(`Fixture read failed: ${error.message}`);
    return data ?? [];
  };

  const appUserId = async (user: TestUser) => {
    const { data, error } = await stack.admin
      .from("app_user")
      .select("id")
      .eq("auth_id", user.authId)
      .single();
    if (error) throw new Error(`Fixture read failed: ${error.message}`);
    return data.id as string;
  };

  let suiteDate = "";

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    // The suite takes seconds; with at least 2 minutes to Rome midnight no dedup pair can straddle it.
    await waitPastRomeMidnight();
    suiteDate = romeDate();
  }, 180_000);

  describe("AT1 dedup: the same alert on the same business date is stored once", () => {
    it("the owner raises the test alert twice and one row exists", async () => {
      const first = await raise(a.owner);
      expect(first.status).toBe(201);
      expect(first.body.deduplicated).toBe(false);
      plainId = first.body.alert.id;

      const second = await raise(a.owner);
      expect(romeDate(), "the clock crossed Rome midnight between the two raises").toBe(suiteDate);
      expect(second.status).toBe(200);
      expect(second.body.deduplicated).toBe(true);
      expect(second.body.alert.id).toBe(plainId);

      expect(await storedAlerts(a, "test_alert")).toHaveLength(1);
    });

    it("the kitchen test alert is a second kind with its own row", async () => {
      const first = await raise(a.owner, { includeKitchen: true });
      expect(first.status).toBe(201);
      kitchenId = first.body.alert.id;
      expect(kitchenId).not.toBe(plainId);
      const again = await raise(a.owner, { includeKitchen: true });
      expect(romeDate(), "the clock crossed Rome midnight between the two raises").toBe(suiteDate);
      expect(again.body.deduplicated).toBe(true);
      expect(again.body.alert.id).toBe(kitchenId);
      expect(await storedAlerts(a)).toHaveLength(2);
    });

    it("another tenant has its own alert for the same day", async () => {
      const raised = await raise(b.owner);
      expect(raised.status).toBe(201);
      otherTenantAlertId = raised.body.alert.id;
      expect(otherTenantAlertId).not.toBe(plainId);
      expect(await storedAlerts(a, "test_alert")).toHaveLength(1);
      expect(await storedAlerts(b, "test_alert")).toHaveLength(1);
    });
  });

  describe("AT6 audience: only the owner and, for kitchen alerts, the chef read an alert", () => {
    it("the owner reads both alerts of the tenant and may raise the test alert", async () => {
      const { status, body } = await list(a.owner);
      expect(status).toBe(200);
      expect(body.alerts.map((alert) => alert.id).sort()).toEqual([plainId, kitchenId].sort());
      expect(body.canRaiseTest).toBe(true);
    });

    it("the owner's answer carries the rendered text and no payload", async () => {
      const text = JSON.stringify((await list(a.owner)).body);
      expect(text).toContain("Avviso di prova");
      expect(text).not.toMatch(/payload|cost_bearing/);
    });

    it("the chef reads only the kitchen alert, without the test card and without any euro", async () => {
      const { status, body } = await list(a.chef);
      expect(status).toBe(200);
      expect(body.alerts.map((alert) => alert.id)).toEqual([kitchenId]);
      expect(body.canRaiseTest).toBe(false);
      expect(JSON.stringify(body)).not.toMatch(/€|eur|cost/i);
    });

    it("the chef's own client cannot read the owner-only alert directly either", async () => {
      const { data, error } = await a.chef.client.from("alert").select("id");
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).toEqual([kitchenId]);
    });

    it("the waiter reads no alert: 403 from the API, zero rows from the table", async () => {
      expect((await list(a.waiter)).status).toBe(403);
      const { data, error } = await a.waiter.client.from("alert").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("the owner of another tenant reads none of tenant A's alerts", async () => {
      const { body } = await list(b.owner, "?filter=all");
      expect(body.alerts.map((alert) => alert.id)).toEqual([otherTenantAlertId]);
      const { data } = await b.owner.client.from("alert").select("id").eq("tenant_id", a.id);
      expect(data).toEqual([]);
    });

    it("the chef cannot raise the test alert: 403 from the API, 42501 from the procedure", async () => {
      expect((await raise(a.chef)).status).toBe(403);
      const { error } = await a.chef.client.rpc("raise_test_alert", { p_include_kitchen: true });
      expect(error?.code).toBe("42501");
      expect((await raise(a.waiter)).status).toBe(403);
    });

    it("no user can write an alert directly", async () => {
      for (const user of [a.owner, a.chef, a.waiter]) {
        const inserted = await user.client.from("alert").insert({
          tenant_id: a.id,
          kind: "test_alert",
          entity_type: "tenant",
          business_date: "2026-01-01",
          severity: "info",
          audience_roles: ["owner"],
          cost_bearing: false,
          payload: {},
        });
        expect(inserted.error?.code, user.role).toBe("42501");
      }
      expect(await storedAlerts(a)).toHaveLength(2);
    });
  });

  describe("AT3 an unacknowledged alert stays visible until someone acknowledges it", () => {
    it("is returned by two consecutive open lists, then leaves the open list after the ack", async () => {
      const ids = async () => (await list(b.owner, "?filter=open")).body.alerts.map((x) => x.id);
      expect(await ids()).toEqual([otherTenantAlertId]);
      expect(await ids()).toEqual([otherTenantAlertId]);

      const acked = await acknowledge(b.owner, otherTenantAlertId);
      expect(acked.status).toBe(200);
      expect(await ids()).toEqual([]);
      expect((await list(b.owner, "?filter=all")).body.alerts.map((x) => x.id)).toEqual([
        otherTenantAlertId,
      ]);
    });
  });

  describe("AT4 acknowledge: sets who and when, a second ack changes nothing", () => {
    it("the owner acknowledges: at and by are stored and shown with the name", async () => {
      const reply = await acknowledge(a.owner, kitchenId);
      expect(reply.status).toBe(200);
      const [row] = (await storedAlerts(a, "test_alert_kitchen"))!;
      expect(row!.acknowledged_at).not.toBeNull();
      expect(row!.acknowledged_by).toBe(await appUserId(a.owner));
      expect(reply.body.alert.acknowledged?.byName).toBe("Titolare Osteria Demo A");
    });

    it("the chef acknowledging the same kitchen alert changes nothing, and sees no other name", async () => {
      const [before] = await storedAlerts(a, "test_alert_kitchen");
      const reply = await acknowledge(a.chef, kitchenId);
      expect(reply.status).toBe(200);
      const [after] = await storedAlerts(a, "test_alert_kitchen");
      expect(after!.acknowledged_by).toBe(before!.acknowledged_by);
      expect(new Date(after!.acknowledged_at!).getTime()).toBe(
        new Date(before!.acknowledged_at!).getTime(),
      );
      expect(reply.body.alert.acknowledged?.at).toBeTruthy();
      expect(reply.body.alert.acknowledged?.byName).toBeNull();
    });

    it("the owner acknowledges the owner-only alert; the stored row is otherwise untouched", async () => {
      expect((await acknowledge(a.owner, plainId)).status).toBe(200);
      const open = await list(a.owner, "?filter=open");
      expect(open.body.alerts).toEqual([]);
    });

    it("an alert the chef cannot read, or that does not exist, is 404", async () => {
      expect((await acknowledge(a.chef, plainId)).status).toBe(404);
      expect((await acknowledge(a.owner, NO_ID)).status).toBe(404);
      // Another tenant's alert is hidden by RLS inside the procedure.
      expect((await acknowledge(b.owner, plainId)).status).toBe(404);
    });

    it("the waiter cannot acknowledge", async () => {
      expect((await acknowledge(a.waiter, kitchenId)).status).toBe(403);
    });

    it("not even the secret key can change or delete an alert", async () => {
      const changed = await stack.admin
        .from("alert")
        .update({ payload: { x: 1 } })
        .eq("id", plainId);
      expect(changed.error).not.toBeNull();
      const deleted = await stack.admin.from("alert").delete().eq("id", plainId);
      expect(deleted.error).not.toBeNull();
    });
  });

  describe("job_run helpers", () => {
    it("the service role records a run and reads it back; a user session is refused", async () => {
      const started = await stack.admin.rpc("job_run_start", { p_job: "extract" });
      expect(started.error).toBeNull();
      expect(typeof started.data).toBe("number");

      const finished = await stack.admin.rpc("job_run_finish", {
        p_id: started.data,
        p_ok: true,
        p_error_code: null,
        p_items: 0,
      });
      expect(finished.error).toBeNull();

      const latest = await stack.admin.rpc("job_run_latest", { p_job: "extract" });
      expect(latest.error).toBeNull();
      expect(latest.data).toHaveLength(1);
      expect(latest.data[0]).toMatchObject({ ok: true, error_code: null, items: 0 });
      expect(latest.data[0].finished_at).not.toBeNull();

      const refused = await a.owner.client.rpc("job_run_start", { p_job: "extract" });
      expect(refused.error).not.toBeNull();
      expect(refused.error?.code).toBe("42501");
    });
  });

  describe("kind registry parity", () => {
    it("the database registry and src/server/alerts/kinds.ts list the same kinds with the same cost flag", async () => {
      const { data, error } = await stack.admin.rpc("alert_kind_list");
      expect(error).toBeNull();
      const byKind = (x: { kind: string }, y: { kind: string }) => x.kind.localeCompare(y.kind);
      const sql = (data as { kind: string; cost_bearing: boolean }[])
        .map(({ kind, cost_bearing }) => ({ kind, costBearing: cost_bearing }))
        .sort(byKind);
      const ts = Object.entries(ALERT_KINDS)
        .map(([kind, { costBearing }]) => ({ kind, costBearing }))
        .sort(byKind);
      expect(sql).toEqual(ts);
    });

    it("lists the M6 test kinds, the M8 price_variance kind, the four M9 payable kinds, the M11 device_locked kind and the M12 negative_stock kind, each with its cost flag", async () => {
      const { data, error } = await stack.admin.rpc("alert_kind_list");
      expect(error).toBeNull();
      const flags = Object.fromEntries(
        (data as { kind: string; cost_bearing: boolean }[]).map((row) => [
          row.kind,
          row.cost_bearing,
        ]),
      );
      expect(flags).toEqual({
        test_alert: false,
        test_alert_kitchen: false,
        device_locked: false,
        price_variance: true,
        payable_due_7d: true,
        payable_due_today: true,
        payable_overdue_3d: true,
        payables_weekly_digest: true,
        negative_stock: false,
      });
      // The same list on the TypeScript side, so a kind added to only one of them fails here.
      expect(
        Object.fromEntries(Object.entries(ALERT_KINDS).map(([k, v]) => [k, v.costBearing])),
      ).toEqual(flags);
    });
  });
});
