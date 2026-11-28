import { randomInt, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/observability/report";
import { claimsOf, signInJar, StepBook, type Account } from "./helpers/mfa";
import { quoteUuid, runSql } from "./helpers/sql";
import { readStackEnv } from "./helpers/stack";

// SP3 step 23 (docs/plans/2026-11-15-sp3-console.md §5 step 23; AT1, AT3, AT12) against the real local stack: GoTrue and its access token hook with the console
// block, select_console, the platform_staff role through PostgREST, the console reads, and the way back to a venue. The route handlers run for real; only
// `createSupabaseServerClient` is replaced, so each call gets a client over a cookie jar, the way production builds one per request (refreshSession writes the new
// cookies into the jar). Fake data only: every address is @example.test, every password and TOTP secret is made during the run.
//
// NOT RUN where it was written (no full stack there): CI runs it. Throws in CI when the stack settings are missing; skips on a developer machine.
// Budget: two password sign-ins. The platform admin row is deactivated at the end (one active platform admin per database), so later suites can bootstrap theirs.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const consoleRoute = await import("@/app/api/platform/console/route");
const tenantsRoute = await import("@/app/api/platform/tenants/route");
const meRoute = await import("@/app/api/me/route");
const switchRoute = await import("@/app/api/me/tenant/route");
const enrolRoute = await import("@/app/api/auth/mfa/account/factors/route");
const verifyRoute = await import("@/app/api/auth/mfa/account/factors/[id]/verify/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
interface Reply {
  status: number;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function send(
  client: SupabaseClient,
  handler: Handler,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<Reply> {
  session.client = client;
  const method = init.method ?? "GET";
  const response = await handler(
    new Request(`http://127.0.0.1:3000${path}`, {
      method,
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    init.params ? { params: Promise.resolve(init.params) } : undefined,
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

const reports = () => vi.mocked(reportError).mock.calls.map(([e]) => String((e as Error).message));
const fakeVat = () => `IT${String(randomInt(0, 1e11)).padStart(11, "0")}`;
/** The raw role claim of the session in a client's jar (claimsOf's type leaves it out). */
const roleOf = async (client: SupabaseClient) =>
  ((await claimsOf(client)) as unknown as { role?: string }).role;

async function authUser(admin: SupabaseClient, label: string) {
  const email = `${label}+${randomUUID().slice(0, 8)}@example.test`;
  const password = `prova ${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const authId = created.data.user?.id;
  if (created.error || !authId)
    throw new Error(`Fixture failed: ${label}: ${created.error?.message}`);
  return { email, password, authId };
}

describe.skipIf(!env)("the console on the real stack (AT1, AT3, AT12)", () => {
  let admin: SupabaseClient;
  let staff: Account;
  let owner: Account;
  let tenantA: string;
  let tenantB: string;
  let browser: { client: SupabaseClient };
  const steps = new StepBook();

  beforeAll(async () => {
    admin = createClient(env!.url, env!.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ownerUser = await authUser(admin, "owner");
    const tenant = async (name: string): Promise<string> => {
      const { data, error } = await admin.rpc("create_tenant_with_owner", {
        tenant_name: name,
        tenant_vat_number: fakeVat(),
        owner_auth_id: ownerUser.authId,
        owner_display_name: "Titolare Demo",
      });
      if (error || typeof data !== "string")
        throw new Error(`Fixture failed: ${name}: ${error?.message}`);
      return data;
    };
    tenantA = await tenant("Osteria Console A");
    tenantB = await tenant("Osteria Console B");
    owner = { role: "owner", appUserId: "", ...ownerUser };

    // The platform admin: an admin row in A and in B, no factor yet, then the bootstrap (service role), as the founder's first run does.
    const staffUser = await authUser(admin, "platform-admin");
    for (const tenantId of [tenantA, tenantB]) {
      const inserted = await admin.from("app_user").insert({
        tenant_id: tenantId,
        auth_id: staffUser.authId,
        role: "admin",
        display_name: "DigiAlto",
      });
      if (inserted.error) throw new Error(`Fixture failed: admin row: ${inserted.error.message}`);
    }
    const boot = await admin.rpc("platform_bootstrap_admin", { p_auth: staffUser.authId });
    if (boot.error) throw new Error(`Fixture failed: bootstrap: ${boot.error.code}`);
    // Set before any expectation, so afterAll always deactivates the row (one active platform admin per database).
    staff = { role: "admin", appUserId: "", ...staffUser };
    expect(boot.data).toEqual({ authId: staffUser.authId, hasVerifiedFactor: false });
    browser = await signInJar(env!, staff);
  }, 120_000);

  afterAll(() => {
    session.client = null;
    if (staff) {
      runSql(
        `update platform.staff set is_active = false where auth_id = ${quoteUuid(staff.authId)}`,
      );
    }
  });

  it("signed in with two admin rows: no tenant claim, role authenticated, and select_console needs a factor first", async () => {
    const claims = await claimsOf(browser.client);
    expect(claims.tenant_id).toBeUndefined();
    expect(await roleOf(browser.client)).toBe("authenticated");
    const reply = await send(
      browser.client,
      consoleRoute.POST as Handler,
      "/api/platform/console",
      {
        method: "POST",
        body: {},
      },
    );
    expect(reply.status).toBe(403);
    expect(reply.body.error.code).toBe("mfa_factor_required");
  });

  it("enrols the account's factor without a membership and reaches aal2", async () => {
    const started = await send(
      browser.client,
      enrolRoute.POST as Handler,
      "/api/auth/mfa/account/factors",
      {
        method: "POST",
        body: { slot: "principale" },
      },
    );
    expect(started.status, JSON.stringify({ body: started.body, reports: reports() })).toBe(200);
    const code = await steps.code(started.body.factorId, started.body.secret);
    const verified = await send(
      browser.client,
      verifyRoute.POST as Handler,
      `/api/auth/mfa/account/factors/${started.body.factorId}/verify`,
      { method: "POST", body: { code }, params: { id: started.body.factorId } },
    );
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.currentLevel).toBe("aal2");
    expect((await claimsOf(browser.client)).aal).toBe("aal2");
  }, 90_000);

  it("AT1: POST /api/platform/console gives a platform_staff token with no tenant claim", async () => {
    const reply = await send(
      browser.client,
      consoleRoute.POST as Handler,
      "/api/platform/console",
      {
        method: "POST",
        body: {},
      },
    );
    expect(reply.status, JSON.stringify({ body: reply.body, reports: reports() })).toBe(200);
    expect(reply.body).toEqual({ mode: "console" });
    const claims = await claimsOf(browser.client);
    expect(await roleOf(browser.client)).toBe("platform_staff");
    expect(claims.tenant_id).toBeUndefined();
    expect(claims.app_role).toBeUndefined();
    expect(claims.aal).toBe("aal2");
  });

  it("AT12: as that token a venue table is 42501 or empty, and a venue route is 403 console_session", async () => {
    const read = await browser.client.from("tenant").select("id");
    expect(read.error?.code === "42501" || (read.data ?? []).length === 0).toBe(true);
    const invoices = await browser.client.from("invoice").select("id");
    expect(invoices.error?.code === "42501" || (invoices.data ?? []).length === 0).toBe(true);
    const me = await send(browser.client, meRoute.GET as Handler, "/api/me");
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe("console_session");
  });

  it("the console reads answer: both venues, DigiAlto attached, no address", async () => {
    const reply = await send(browser.client, tenantsRoute.GET as Handler, "/api/platform/tenants");
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    const mine = (reply.body.tenants as { id: string; digialtoAttached: boolean }[]).filter((t) =>
      [tenantA, tenantB].includes(t.id),
    );
    expect(mine.map((t) => t.digialtoAttached)).toEqual([true, true]);
    expect(JSON.stringify(reply.body)).not.toContain("@");
  });

  it("AT12: leaving console mode gives an authenticated token, and select_tenant(A) then gives A's claims", async () => {
    const left = await browser.client.rpc("platform_leave_console");
    expect(left.error).toBeNull();
    expect(left.data).toEqual({ changed: true });
    const refreshed = await browser.client.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(await roleOf(browser.client)).toBe("authenticated");
    expect((await claimsOf(browser.client)).tenant_id).toBeUndefined();
    const reply = await send(browser.client, switchRoute.POST as Handler, "/api/me/tenant", {
      method: "POST",
      body: { tenantId: tenantA },
    });
    expect(reply.status, JSON.stringify({ body: reply.body, reports: reports() })).toBe(200);
    const claims = await claimsOf(browser.client);
    expect(claims.tenant_id).toBe(tenantA);
    expect(claims.app_role).toBe("admin");
    expect(await roleOf(browser.client)).toBe("authenticated");
  });

  it("the console audit holds console.entered and console.left for this admin", () => {
    const rows = runSql(
      `select string_agg(action, ',' order by id) from platform.audit_event where actor_auth_id = ${quoteUuid(staff.authId)}`,
    );
    expect(rows).toBe("platform_admin.factor_enrolled,console.entered,console.left");
  });

  it("a venue owner of two venues keeps today's claims (no console row, role authenticated)", async () => {
    const other = await signInJar(env!, owner);
    const claims = await claimsOf(other.client);
    expect(await roleOf(other.client)).toBe("authenticated");
    expect(claims.tenant_id).toBeUndefined();
    expect(claims.app_role).toBeUndefined();
    const reply = await send(other.client, consoleRoute.POST as Handler, "/api/platform/console", {
      method: "POST",
      body: {},
    });
    expect(reply.status).toBe(403);
    expect(reply.body.error.code).toBe("forbidden");
    expect(await roleOf(other.client)).toBe("authenticated");
  });

  it("a single-venue owner keeps today's claims: its venue, role authenticated (the PIN branch is pinned by staff-pin.int.ts and pgTAP 085)", async () => {
    const single = await authUser(admin, "owner-single");
    const created = await admin.rpc("create_tenant_with_owner", {
      tenant_name: "Osteria Console C",
      tenant_vat_number: fakeVat(),
      owner_auth_id: single.authId,
      owner_display_name: "Titolare Demo",
    });
    if (created.error || typeof created.data !== "string")
      throw new Error("Fixture failed: single venue");
    const jar = await signInJar(env!, { role: "owner", appUserId: "", ...single });
    const claims = await claimsOf(jar.client);
    expect(claims.tenant_id).toBe(created.data);
    expect(claims.app_role).toBe("owner");
    expect(await roleOf(jar.client)).toBe("authenticated");
  });
});
