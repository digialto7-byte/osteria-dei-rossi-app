import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ManageMenu } from "@/server/menu/output";
import { createStack, readStackEnv, type Stack, type TestUser } from "./helpers/stack";

// SP1 step 18, integration: a tenant's sale VAT list, set through PATCH /api/settings/venue, reaches the menu form payload and
// refuses a price at a rate the tenant no longer sells at. The routes run for real (schemas, role checks, error mapping, the
// set_tenant_settings and menu procedures, the sale-VAT trigger, RLS); only `createSupabaseServerClient` is replaced, as in the
// other suites, so each call carries the signed-in test user's own client. Fake data only ("Osteria Demo A" and "B").
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  return { createSupabaseServerClient: async () => asUser.store!.getStore() };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const venueRoute = await import("@/app/api/settings/venue/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");

type Handler = (request: Request) => Promise<Response>;

describe.skipIf(!env)("tenant sale VAT list on the real stack", () => {
  let stack: Stack;

  async function call<T = Record<string, unknown>>(
    user: TestUser,
    handler: Handler,
    method: string,
    path: string,
    body?: object,
  ) {
    return asUser.store!.run(user.client, async () => {
      const response = await handler(
        new Request(`http://localhost:3000${path}`, {
          method,
          headers: method === "GET" ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, body: (await response.json()) as T };
    });
  }

  const item = (price: number, vatRate: number, name: string) => ({
    name,
    category: "Bevande",
    course: "bevande",
    recipeKey: null,
    price,
    vatRate,
  });

  beforeAll(async () => {
    stack = await createStack(env!);
  });

  it("B's owner sets the sale list to [10, 22]; the menu form payload lists two rates; a 4 % price is a 422", async () => {
    const b = stack.tenantB;

    const set = await call<{ changed: boolean; settings: { saleVatRates: number[] } }>(
      b.owner,
      venueRoute.PATCH as Handler,
      "PATCH",
      "/api/settings/venue",
      { saleVatRates: [10, 22] },
    );
    expect(set.status).toBe(200);
    expect(set.body.changed).toBe(true);
    expect(set.body.settings.saleVatRates).toEqual([10, 22]);

    const form = await call<ManageMenu>(
      b.owner,
      menuItemsRoute.GET as Handler,
      "GET",
      "/api/menu/items",
    );
    expect(form.status).toBe(200);
    expect(form.body.vatRates).toEqual([10, 22]);

    const refused = await call<{ error: { code: string } }>(
      b.owner,
      menuItemsRoute.POST as Handler,
      "POST",
      "/api/menu/items",
      item(2, 4, "Acqua 4 (demo)"),
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("vat_rate_invalid");

    const accepted = await call(
      b.owner,
      menuItemsRoute.POST as Handler,
      "POST",
      "/api/menu/items",
      item(2, 10, "Acqua 10 (demo)"),
    );
    expect(accepted.status).toBe(201);
  });

  it("tenant A is unchanged: its menu form still lists the five statutory rates and accepts 4 %", async () => {
    const a = stack.tenantA;
    const form = await call<ManageMenu>(
      a.owner,
      menuItemsRoute.GET as Handler,
      "GET",
      "/api/menu/items",
    );
    expect(form.body.vatRates).toEqual([0, 4, 5, 10, 22]);
    const made = await call(
      a.owner,
      menuItemsRoute.POST as Handler,
      "POST",
      "/api/menu/items",
      item(2, 4, "Pane 4 (demo)"),
    );
    expect(made.status).toBe(201);
  });

  it("a waiter cannot change the list: 403", async () => {
    const denied = await call(
      stack.tenantB.waiter,
      venueRoute.PATCH as Handler,
      "PATCH",
      "/api/settings/venue",
      { saleVatRates: [0, 4, 5, 10, 22] },
    );
    expect(denied.status).toBe(403);
  });
});
