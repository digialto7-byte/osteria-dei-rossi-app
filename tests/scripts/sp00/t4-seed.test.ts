import { describe, expect, it, vi, type Mock } from "vitest";
import { buildPurgeDeps, buildSeedDeps } from "../../../scripts/lib/demo/main";
import { ADMIN_EMAIL, OWNER_LOCAL_EMAIL } from "../../../scripts/lib/demo/fixture";
import type { SeedOutcome } from "../../../scripts/lib/demo/seed";
import type { CaseReport } from "../../../scripts/lib/sp00/report";
import { formatT4Seed, runT4Seed, type T4SeedDeps } from "../../../scripts/lib/sp00/t4-seed";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TABLE = "22222222-2222-4222-8222-222222222222";
const DISH = "33333333-3333-4333-8333-333333333333";
const WAITER_TOKEN = "waiter-access-token";
const CHEF_TOKEN = "chef-access-token";
const PREFLIGHT_OK: CaseReport = { id: "preflight", result: "pass", detail: { status: 200 } };
const SEED_OK: SeedOutcome = {
  ok: true,
  tenantId: TENANT,
  counts: { suppliers: 3, invoices: 7 },
  logins: [],
  alerts: [],
};

type Mocked = { [K in keyof T4SeedDeps]: Mock<T4SeedDeps[K]> };

function makeDeps(overrides: Partial<T4SeedDeps> = {}): Mocked {
  const base: T4SeedDeps = {
    createTenant: async () => TENANT,
    runSeed: async () => SEED_OK,
    createStaff: async (_tenant, role) => ({
      email: `${role}@example.test`,
      password: role === "chef" ? "C".repeat(43) : "P".repeat(43),
    }),
    staffSignIn: async (email) => ({
      status: 200,
      code: null,
      session: {
        accessToken: email.startsWith("chef") ? CHEF_TOKEN : WAITER_TOKEN,
        refreshToken: "r",
      },
    }),
    rest: async (_token, _method, path) => {
      if (path === "/rpc/tables_list")
        return { status: 200, code: null, body: { tables: [{ id: TABLE, name: "T1" }] } };
      if (path === "/rpc/menu_list") {
        return {
          status: 200,
          code: null,
          body: {
            categories: [
              {
                name: "x",
                items: [
                  { id: "no", course: "primi", available: false, priceUnit: "portion" },
                  { id: DISH, course: "secondi", available: true, priceUnit: "portion" },
                ],
              },
            ],
          },
        };
      }
      return { status: 200, code: null, body: {} };
    },
    newId: (() => {
      let n = 0;
      return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    })(),
    stamp: () => "2026-11-14T12:00:00.000Z",
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(base).map(([name, fn]) => [name, vi.fn(fn as (...args: never[]) => unknown)]),
  ) as unknown as Mocked;
}

describe("runT4Seed", () => {
  it("runs the preflight result first: a failed one stops before any call, hosted without one throws", async () => {
    const deps = makeDeps();
    const failed: CaseReport = {
      id: "preflight",
      result: "inconclusive",
      detail: { status: 401, reason: "secret key not injected" },
    };
    const result = await runT4Seed(deps, "temp", failed);
    expect(result).toMatchObject({ ok: false, error: "preflight failed", tenantId: null });
    for (const fn of Object.values(deps)) expect(fn).not.toHaveBeenCalled();
    await expect(runT4Seed(makeDeps(), "temp", null)).rejects.toThrow(/preflight/);
    expect((await runT4Seed(makeDeps(), "temp", PREFLIGHT_OK)).ok).toBe(true);
  });

  it("makes 'Osteria Demo SP0' with VAT IT00000000000 and its own spike owner, then seeds that tenant", async () => {
    const deps = makeDeps();
    const result = await runT4Seed(deps, "local", null);
    expect(deps.createTenant.mock.calls[0]?.[0]).toMatchObject({
      name: "Osteria Demo SP0",
      vatNumber: "IT00000000000",
    });
    // The demo seed creates the demo owner and admin itself: the tenant's first owner must be another address, or Auth refuses
    // the demo owner with email_exists (local SP0 run, job 132561291575).
    const ownerEmail = deps.createTenant.mock.calls[0]?.[0].ownerEmail;
    expect(ownerEmail).toMatch(/^sp0-t4-owner-[0-9a-f]{8}@example\.test$/);
    expect([OWNER_LOCAL_EMAIL, ADMIN_EMAIL]).not.toContain(ownerEmail);
    expect(deps.createTenant.mock.invocationCallOrder[0]).toBeLessThan(
      deps.runSeed.mock.invocationCallOrder[0] ?? 0,
    );
    expect(deps.runSeed).toHaveBeenCalledWith(TENANT);
    expect(result).toMatchObject({
      ok: true,
      tenantId: TENANT,
      counts: { suppliers: 3, invoices: 7 },
    });
  });

  it("a failed seed stops with the seed's error code and touches no waiter or order call", async () => {
    const deps = makeDeps({
      runSeed: async () => ({ ...SEED_OK, ok: false, error: "tenant_has_operational_data" }),
    });
    const result = await runT4Seed(deps, "local", null);
    expect(result).toMatchObject({
      ok: false,
      error: "tenant_has_operational_data",
      tenantId: TENANT,
    });
    expect(deps.createStaff).not.toHaveBeenCalled();
    expect(deps.rest).not.toHaveBeenCalled();
  });

  it("a failed tenant creation reports the step and does not seed", async () => {
    const deps = makeDeps({
      createTenant: async () => {
        throw new TypeError("x https://a.supabase.co");
      },
    });
    expect(await runT4Seed(deps, "local", null)).toMatchObject({
      ok: false,
      error: "create tenant failed (TypeError)",
      tenantId: null,
    });
    expect(deps.runSeed).not.toHaveBeenCalled();
  });

  it("opens a table, adds a line and fires it with the WAITER's token only (no admin call for the order entry)", async () => {
    const deps = makeDeps();
    await runT4Seed(deps, "local", null);
    const calls = deps.rest.mock.calls as unknown as [
      string,
      string,
      string,
      Record<string, unknown> | undefined,
    ][];
    expect(calls.map((c) => c[2])).toEqual([
      "/rpc/tables_list",
      "/rpc/menu_list",
      "/rpc/open_table",
      "/rpc/add_order_line",
      "/rpc/fire_course",
      "/rpc/kitchen_mark_line",
    ]);
    for (const call of calls.slice(0, 5)) expect(call[0]).toBe(WAITER_TOKEN);
    // the kitchen mark (owner, admin or chef only) is the chef's own call, so kitchen_event is not empty
    expect(calls[5]?.[0]).toBe(CHEF_TOKEN);
    const open = calls[2]?.[3] as { p_table: string; p_session: string; p_covers: number };
    expect(open.p_table).toBe(TABLE);
    expect(open.p_covers).toBe(2);
    const add = calls[3]?.[3] as { p_session: string; p_body: Record<string, unknown> };
    expect(add.p_session).toBe(open.p_session);
    expect(add.p_body).toMatchObject({
      menuItemId: DISH,
      course: "secondi",
      clientUpdatedAt: "2026-11-14T12:00:00.000Z",
    });
    const fire = calls[4]?.[3] as { p_session: string; p_body: { lineIds: string[] } };
    expect(fire.p_body.lineIds).toEqual([add.p_body.lineId]);
    // the waiter is made by the admin side and signs in; the sign-in uses the password that was made
    expect(deps.createStaff).toHaveBeenCalledWith(TENANT, "waiter");
    expect(deps.createStaff).toHaveBeenCalledWith(TENANT, "chef");
    expect(deps.staffSignIn).toHaveBeenCalledWith("waiter@example.test", "P".repeat(43));
    expect(deps.staffSignIn).toHaveBeenCalledWith("chef@example.test", "C".repeat(43));
  });

  it("stops at the first refused order step and names it with the status", async () => {
    const deps = makeDeps({
      rest: async (_t, _m, path) => {
        if (path === "/rpc/tables_list")
          return { status: 200, code: null, body: { tables: [{ id: TABLE }] } };
        if (path === "/rpc/menu_list")
          return {
            status: 200,
            code: null,
            body: {
              categories: [
                { items: [{ id: DISH, course: "primi", available: true, priceUnit: "portion" }] },
              ],
            },
          };
        return { status: 409, code: "P0001", body: null };
      },
    });
    const result = await runT4Seed(deps, "local", null);
    expect(result).toMatchObject({ ok: false, error: "open table refused (status 409)" });
    expect(deps.rest.mock.calls.map((c) => c[2])).toEqual([
      "/rpc/tables_list",
      "/rpc/menu_list",
      "/rpc/open_table",
    ]);
  });

  it("fails clearly when there is no table or no dish to sell", async () => {
    const noTable = makeDeps({
      rest: async () => ({ status: 200, code: null, body: { tables: [] } }),
    });
    expect(await runT4Seed(noTable, "local", null)).toMatchObject({
      ok: false,
      error: "the seeded tenant has no table",
    });
    const noDish = makeDeps({
      rest: async (_t, _m, path) =>
        path === "/rpc/tables_list"
          ? { status: 200, code: null, body: { tables: [{ id: TABLE }] } }
          : {
              status: 200,
              code: null,
              body: {
                categories: [
                  { items: [{ id: "x", course: "primi", available: false, priceUnit: "portion" }] },
                ],
              },
            },
    });
    expect(await runT4Seed(noDish, "local", null)).toMatchObject({
      ok: false,
      error: "the seeded tenant has no dish that can be sold",
    });
  });

  it("a refused kitchen mark fails the mark step with its status", async () => {
    const deps = makeDeps({
      rest: async (_t, _m, path) => {
        if (path === "/rpc/tables_list")
          return { status: 200, code: null, body: { tables: [{ id: TABLE }] } };
        if (path === "/rpc/menu_list")
          return {
            status: 200,
            code: null,
            body: {
              categories: [
                { items: [{ id: DISH, course: "primi", available: true, priceUnit: "portion" }] },
              ],
            },
          };
        return path === "/rpc/kitchen_mark_line"
          ? { status: 403, code: "42501", body: null }
          : { status: 200, code: null, body: {} };
      },
    });
    expect(await runT4Seed(deps, "local", null)).toMatchObject({
      ok: false,
      error: "kitchen mark refused (status 403)",
    });
  });

  it("a waiter sign-in that gives no session fails the waiter step", async () => {
    const deps = makeDeps({
      staffSignIn: async () => ({ status: 400, code: "invalid_credentials", session: null }),
    });
    expect(await runT4Seed(deps, "local", null)).toMatchObject({
      ok: false,
      error: "waiter sign-in refused (status 400)",
    });
  });
});

describe("formatT4Seed", () => {
  it("prints one JSON line with the tenant id and the counts, and no address", async () => {
    const result = await runT4Seed(makeDeps(), "local", null);
    const line = formatT4Seed("local", result, ["placeholder-not-a-key"]);
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      check: "t4-seed",
      target: "local",
      ok: true,
      tenantId: TENANT,
      counts: { suppliers: 3 },
    });
    expect(line).not.toMatch(/@|https?:|eyJ/);
  });

  it("refuses a result that would leak a value", () => {
    expect(() =>
      formatT4Seed(
        "local",
        { ok: false, error: "x@example.test", tenantId: null, counts: {}, steps: [] },
        ["placeholder-not-a-key"],
      ),
    ).toThrow(/Report refused/);
  });
});

describe("the demo seed is driven with the spike's own clients", () => {
  it("buildSeedDeps and buildPurgeDeps use the admin client they are given", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const adminApi = { listUsers: vi.fn() };
    const admin = { rpc, auth: { admin: adminApi } } as never;
    const purge = buildPurgeDeps(admin);
    const deps = buildSeedDeps(
      admin,
      purge,
      "http://127.0.0.1:54321",
      "test-publishable-key",
      () => new Date("2026-11-14T10:00:00Z"),
    );
    expect(deps.authAdmin).toBe(adminApi);
    expect(purge.authAdmin).toBe(adminApi);
    await deps.service.rpc("demo_tenant_state", { p_tenant: TENANT });
    expect(rpc).toHaveBeenCalledWith("demo_tenant_state", { p_tenant: TENANT });
    expect(deps.ownerEmail).toBe(OWNER_LOCAL_EMAIL);
  });
});
