import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/observability/report";
import { claimsOf, signInJar, StepBook } from "./helpers/mfa";
import { createTwoVenueOwner } from "./helpers/memberships";
import { readStackEnv } from "./helpers/stack";

// SP2 S7 (docs/plans/2026-11-26-sp02-memberships.md §5 S7, AT4 and AT5 end to end) against the real local stack: GoTrue, the access token hook with its
// e-mail branch, select_tenant, the #79 gate. The route handlers run for real; only `createSupabaseServerClient` is replaced, so each call is handed a
// client over a cookie jar, the way production builds one per request (the switch's refreshSession writes the new cookies into the jar).
//
// The PIN side of AT5 (a staff PIN login still signs in and refreshes with its tenant) is tests/integration/staff-pin.int.ts, unchanged, which runs
// on the new hook in the same CI job.
//
// NOT RUN where it was written (no full stack there): CI runs it. Throws in CI when the stack settings are missing; skips on a developer machine.
// Budget: five password sign-ins (Auth's bucket is 30 per 5 minutes per IP, shared with the other suites).
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const meRoute = await import("@/app/api/me/route");
const tenantsRoute = await import("@/app/api/me/tenants/route");
const switchRoute = await import("@/app/api/me/tenant/route");
const enrolRoute = await import("@/app/api/me/mfa/factors/route");
const verifyRoute = await import("@/app/api/me/mfa/factors/[id]/verify/route");

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
    new Request(`http://localhost:3000${path}`, {
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
const SWITCH_INTERVAL_MS = 3_100;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!env)("memberships: one login, two venues, on the real stack", () => {
  let admin: SupabaseClient;
  let fixture: Awaited<ReturnType<typeof createTwoVenueOwner>>;
  let first: { client: SupabaseClient };
  let second: { client: SupabaseClient };

  const me = (client: SupabaseClient) => send(client, meRoute.GET as Handler, "/api/me");
  const switchTo = (client: SupabaseClient, tenantId: string) =>
    send(client, switchRoute.POST as Handler, "/api/me/tenant", {
      method: "POST",
      body: { tenantId },
    });

  beforeAll(async () => {
    admin = createClient(env!.url, env!.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    fixture = await createTwoVenueOwner(admin);
    first = await signInJar(env!, fixture.owner);
  }, 120_000);

  afterAll(() => {
    session.client = null;
  });

  it("signs in without a tenant claim; every tenant route answers 409, the list shows both venues and none current", async () => {
    const claims = await claimsOf(first.client);
    expect(claims.tenant_id).toBeUndefined();
    expect(claims.app_role).toBeUndefined();
    const reply = await me(first.client);
    expect(reply.status).toBe(409);
    expect(reply.body.error.code).toBe("tenant_selection_required");
    const list = await send(first.client, tenantsRoute.GET as Handler, "/api/me/tenants");
    expect(list.status).toBe(200);
    expect(list.body).toEqual({
      tenants: [
        { id: fixture.tenantA, name: "Osteria Demo A", role: "owner", current: false },
        { id: fixture.tenantB, name: "Osteria Demo B", role: "owner", current: false },
      ],
    });
  });

  it("switches to A: the new token carries A with the same aal, /api/me answers A", async () => {
    const before = await claimsOf(first.client);
    const reply = await switchTo(first.client, fixture.tenantA);
    expect(reply.status, JSON.stringify({ body: reply.body, reports: reports() })).toBe(200);
    expect(reply.body).toEqual({ tenantId: fixture.tenantA });
    const after = await claimsOf(first.client);
    expect(after.tenant_id).toBe(fixture.tenantA);
    expect(after.app_role).toBe("owner");
    expect(after.aal).toBe(before.aal);
    // Straight after a switch (well inside the 3 s interval): a switch to B is 429 and changes nothing.
    const tooSoon = await switchTo(first.client, fixture.tenantB);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe("tenant_switch_too_soon");
    expect((await claimsOf(first.client)).tenant_id).toBe(fixture.tenantA);
    const read = await me(first.client);
    expect(read.status).toBe(200);
    expect(read.body.tenant).toMatchObject({ id: fixture.tenantA, name: "Osteria Demo A" });
  });

  it("after the interval the same session switches to B", async () => {
    await pause(SWITCH_INTERVAL_MS);
    const reply = await switchTo(first.client, fixture.tenantB);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect((await claimsOf(first.client)).tenant_id).toBe(fixture.tenantB);
    expect((await me(first.client)).body.tenant.id).toBe(fixture.tenantB);
  }, 20_000);

  it("a tenant the login does not belong to is 404, and the session keeps B", async () => {
    const reply = await switchTo(first.client, "99999999-9999-4999-8999-999999999999");
    expect(reply.status).toBe(404);
    expect(reply.body.error.code).toBe("tenant_not_found");
    expect((await claimsOf(first.client)).tenant_id).toBe(fixture.tenantB);
  });

  it("AT4: two sign-ins of the same login hold A and B at once", async () => {
    second = await signInJar(env!, fixture.owner);
    expect((await switchTo(second.client, fixture.tenantA)).status).toBe(200);
    expect((await me(second.client)).body.tenant.id).toBe(fixture.tenantA);
    expect((await me(first.client)).body.tenant.id).toBe(fixture.tenantB);
    // A refresh of each session keeps its own choice (the selection is keyed by session).
    for (const [jar, tenant] of [
      [first, fixture.tenantB],
      [second, fixture.tenantA],
    ] as const) {
      const { error } = await jar.client.auth.refreshSession();
      expect(error).toBeNull();
      expect((await claimsOf(jar.client)).tenant_id).toBe(tenant);
    }
  });

  it("with a TOTP factor the switch keeps aal2", async () => {
    const steps = new StepBook();
    const started = await send(second.client, enrolRoute.POST as Handler, "/api/me/mfa/factors", {
      method: "POST",
      body: { slot: "principale" },
    });
    expect(started.status, JSON.stringify({ body: started.body, reports: reports() })).toBe(201);
    const { factorId, secret } = started.body as { factorId: string; secret: string };
    const verified = await send(
      second.client,
      verifyRoute.POST as Handler,
      `/api/me/mfa/factors/${factorId}/verify`,
      {
        method: "POST",
        body: { code: await steps.code(factorId, secret) },
        params: { id: factorId },
      },
    );
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect((await claimsOf(second.client)).aal).toBe("aal2");

    await pause(SWITCH_INTERVAL_MS);
    const reply = await switchTo(second.client, fixture.tenantB);
    expect(reply.status, JSON.stringify({ body: reply.body, reports: reports() })).toBe(200);
    const after = await claimsOf(second.client);
    expect(after.tenant_id).toBe(fixture.tenantB);
    expect(after.aal).toBe("aal2");
    expect((await me(second.client)).status).toBe(200);
  }, 90_000);

  it("no tenant name reached a report", () => {
    for (const message of reports()) expect(message).not.toMatch(/Osteria/);
  });
});
