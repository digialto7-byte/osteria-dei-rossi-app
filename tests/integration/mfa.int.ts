import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isSessionExpired, signedInAt } from "@/lib/auth/session-age";
import { runMfaReset } from "../../scripts/lib/mfa-admin";
import { latestCodeFor } from "./helpers/auth-mail";
import { CookieJar, createJarClient } from "./helpers/cookie-jar";
import { claimsOf, createVenue, factorCallCounter, signInJar, StepBook } from "./helpers/mfa";
import { appTables, quoteUuid, runSql, tableText } from "./helpers/sql";
import { readStackEnv } from "./helpers/stack";

// P2-1 A15 (docs/plans/2026-11-12-p2-1-totp.md section 5 A15, AT-T1 to AT-T11), against the real local stack: Supabase Auth TOTP (enabled in supabase/config.toml), the
// aal gate in Postgres, the route handlers for real. Only `createSupabaseServerClient` is replaced, so each call is handed a client over a cookie jar, the way
// production builds one per request. The TOTP codes come from e2e/helpers/totp.ts (RFC 6238, node:crypto); the secrets are the ones the local Auth server generates.
//
// NOT RUN where it was written (no Docker there): CI runs it. Throws in CI when the stack settings are missing; skips on a developer machine. The reset is DigiAlto's
// script (founder decision Q-T1 = V1), so step (6) runs scripts/lib/mfa-admin.ts against the real stack, and there is no reset route to call.
//
// Budget: Auth's password sign-in bucket (30 per 5 minutes per IP) is shared with the other suites, so the suite signs in about a dozen times. Each code waits for a fresh
// 30 second step when the same factor was just used, so the tests carry a long timeout.
const env = readStackEnv();
const MAILPIT_URL = process.env.E2E_MAILPIT_URL;
if (env && process.env.CI && !MAILPIT_URL) throw new Error("E2E_MAILPIT_URL must be set in CI");

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const meRoute = await import("@/app/api/me/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");
const exportRoute = await import("@/app/api/exports/[file]/route");
const tablesRoute = await import("@/app/api/tables/route");
const statusRoute = await import("@/app/api/me/mfa/route");
const enrolRoute = await import("@/app/api/me/mfa/factors/route");
const verifyRoute = await import("@/app/api/me/mfa/factors/[id]/verify/route");
const challengeRoute = await import("@/app/api/auth/mfa/challenge/route");
const accountsRoute = await import("@/app/api/mfa/accounts/route");
const magicLinkRoute = await import("@/app/api/auth/magic-link/route");
const emailCodeRoute = await import("@/app/api/auth/email-code/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
interface Reply {
  status: number;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  error: { code: string; message: string; details?: Record<string, unknown> };
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
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }
  return { status: response.status, body, error: body.error };
}

describe.skipIf(!env)("second factor (TOTP) on the real stack", () => {
  const steps = new StepBook();
  const secrets: string[] = [];
  const usedCodes: string[] = [];
  const counter = factorCallCounter();
  let admin: SupabaseClient;
  let venue: Awaited<ReturnType<typeof createVenue>>;
  let ownerA: { jar: CookieJar; client: SupabaseClient };
  let ownerB: { jar: CookieJar; client: SupabaseClient };
  let adminA: { jar: CookieJar; client: SupabaseClient };
  let reserveA: { jar: CookieJar; client: SupabaseClient };
  let waiter: { jar: CookieJar; client: SupabaseClient };
  let chef: { jar: CookieJar; client: SupabaseClient };
  const factors = { owner: { principale: "", riserva: "" }, admin: "", reserve: "" };
  const secretOf = new Map<string, string>();

  /** Enrols a factor in the given slot for a signed-in client and passes the first code. */
  async function enrol(client: SupabaseClient, slot: "principale" | "riserva") {
    const started = await send(client, enrolRoute.POST as Handler, "/api/me/mfa/factors", {
      method: "POST",
      body: { slot },
    });
    expect(started.status).toBe(201);
    const { factorId, secret, qrImage } = started.body as {
      factorId: string;
      secret: string;
      qrImage: string;
    };
    expect(qrImage.startsWith("data:image/svg+xml;utf-8,%3Csvg")).toBe(true);
    secrets.push(secret);
    secretOf.set(factorId, secret);
    const code = await steps.code(factorId, secret);
    usedCodes.push(code);
    const verified = await send(
      client,
      verifyRoute.POST as Handler,
      `/api/me/mfa/factors/${factorId}/verify`,
      {
        method: "POST",
        body: { code },
        params: { id: factorId },
      },
    );
    expect(verified.status).toBe(200);
    expect(verified.body.currentLevel).toBe("aal2");
    return factorId;
  }

  async function challenge(client: SupabaseClient, factorId: string) {
    const code = await steps.code(factorId, secretOf.get(factorId)!);
    usedCodes.push(code);
    return send(client, challengeRoute.POST as Handler, "/api/auth/mfa/challenge", {
      method: "POST",
      body: { factorId, code, next: "/fatture" },
    });
  }

  const get = (
    client: SupabaseClient,
    handler: Handler,
    path: string,
    params?: Record<string, string>,
  ) => send(client, handler, path, { params });

  beforeAll(async () => {
    admin = createClient(env!.url, env!.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    venue = await createVenue(env!, admin);
    ownerA = await signInJar(env!, venue.owner, counter.fetch);
    ownerB = await signInJar(env!, venue.owner);
    adminA = await signInJar(env!, venue.admin);
    reserveA = await signInJar(env!, venue.adminReserve, counter.fetch);
    waiter = await signInJar(env!, venue.waiter);
    chef = await signInJar(env!, venue.chef);
  }, 180_000);

  afterAll(() => {
    session.client = null;
  });

  it("(1) deploy day: with nobody enrolled, the owner and the admin read /api/me, the menu and an export as before; so does the waiter", async () => {
    for (const who of [ownerA, adminA]) {
      expect((await get(who.client, meRoute.GET as Handler, "/api/me")).status).toBe(200);
      expect((await get(who.client, menuItemsRoute.GET as Handler, "/api/menu/items")).status).toBe(
        200,
      );
      expect(
        (
          await get(who.client, exportRoute.GET as Handler, "/api/exports/items.csv?period=day", {
            file: "items.csv",
          })
        ).status,
      ).toBe(200);
      expect(
        (await get(who.client, accountsRoute.GET as Handler, "/api/mfa/accounts")).status,
      ).toBe(200);
    }
    expect((await get(waiter.client, tablesRoute.GET as Handler, "/api/tables")).status).toBe(200);
    const status = await get(ownerA.client, statusRoute.GET as Handler, "/api/me/mfa");
    expect(status.body).toMatchObject({
      role: "owner",
      mode: "enrolled",
      gate: "ok",
      factors: [],
      canAddFactor: true,
    });
  });

  it("(8, 10) the chef and the waiter get 403 from the MFA routes and are never gated", async () => {
    for (const who of [chef, waiter]) {
      expect((await get(who.client, statusRoute.GET as Handler, "/api/me/mfa")).status).toBe(403);
      expect(
        (await get(who.client, accountsRoute.GET as Handler, "/api/mfa/accounts")).status,
      ).toBe(403);
    }
    expect((await get(chef.client, meRoute.GET as Handler, "/api/me")).status).toBe(200);
  });

  it("(2) the owner enrols; the other session of theirs is refused and ends; a fresh sign-in meets the challenge and passes it", async () => {
    expect((await get(ownerB.client, meRoute.GET as Handler, "/api/me")).status).toBe(200); // before: no factor, no gate
    factors.owner.principale = await enrol(ownerA.client, "principale");
    expect((await claimsOf(ownerA.client)).aal).toBe("aal2");

    // Device B was opened before: its aal1 token is refused at once (the owner has a factor now), and its refresh fails because Supabase deleted that session.
    const refused = await get(ownerB.client, meRoute.GET as Handler, "/api/me");
    expect(refused.status).toBe(403);
    expect(refused.error.code).toBe("mfa_required");
    expect((await ownerB.client.auth.refreshSession()).error).not.toBeNull();

    // A forced refresh on the enrolling device keeps aal2; amr holds totp and the 30 days still count from the password entry.
    expect((await ownerA.client.auth.refreshSession()).error).toBeNull();
    const after = await claimsOf(ownerA.client);
    expect(after.aal).toBe("aal2");
    expect(after.amr.some((entry) => entry.method === "totp")).toBe(true);
    const password = after.amr.find((entry) => entry.method === "password")!;
    expect(signedInAt(after)).toBe(password.timestamp);
    expect(isSessionExpired(after, (password.timestamp + 30 * 86_400) * 1000 - 1000)).toBe(false);
    expect(isSessionExpired(after, (password.timestamp + 30 * 86_400) * 1000)).toBe(true);

    // A fresh password sign-in is at aal1 and meets the challenge.
    const fresh = await signInJar(env!, venue.owner);
    expect((await claimsOf(fresh.client)).aal).toBe("aal1");
    const status = await get(fresh.client, statusRoute.GET as Handler, "/api/me/mfa");
    expect(status.body.gate).toBe("challenge");
    expect(status.body.factors).toHaveLength(1);
    expect((await get(fresh.client, meRoute.GET as Handler, "/api/me")).error.code).toBe(
      "mfa_required",
    );
    const passed = await challenge(fresh.client, factors.owner.principale);
    expect(passed.status).toBe(200);
    expect(passed.body).toEqual({ redirect: "/fatture" });
    expect((await claimsOf(fresh.client)).aal).toBe("aal2");
    expect((await get(fresh.client, meRoute.GET as Handler, "/api/me")).status).toBe(200);
    ownerB = fresh;
    expect(
      runSql(
        `select count(*) from public.audit_event where action = 'app_user.mfa_enrolled' and entity_id = ${quoteUuid(venue.owner.appUserId)}`,
      ),
    ).toBe("1");
    // The staff are untouched throughout.
    expect((await get(waiter.client, tablesRoute.GET as Handler, "/api/tables")).status).toBe(200);
  }, 180_000);

  it("(3) no bypass: the e-mail code gives aal1 and the same challenge; the aal1 token against the Data API sees nothing", async () => {
    if (!MAILPIT_URL) return;
    const jar = new CookieJar();
    const client = createJarClient(env!, jar);
    expect(
      (
        await send(client, magicLinkRoute.POST as Handler, "/api/auth/magic-link", {
          method: "POST",
          body: { email: venue.owner.email },
        })
      ).status,
    ).toBe(202);
    const code = await latestCodeFor(MAILPIT_URL, venue.owner.email);
    const signedIn = await send(client, emailCodeRoute.POST as Handler, "/api/auth/email-code", {
      method: "POST",
      body: { email: venue.owner.email, code },
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.redirect.startsWith("/login/codice?next=")).toBe(true);
    expect((await claimsOf(client)).aal).toBe("aal1");
    expect((await get(client, meRoute.GET as Handler, "/api/me")).error.code).toBe("mfa_required");

    // One invoice exists for the venue (inserted by the database owner), so "no rows" is not vacuous.
    runSql(
      `insert into public.invoice (tenant_id, file_path, file_mime, file_size_bytes)
         values (${quoteUuid(venue.tenantId)}, '${venue.tenantId}/2026/${randomUUID()}.pdf', 'application/pdf', 1000)`,
    );
    const direct = await client.from("invoice").select("id");
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);
    const rpc = await client.rpc("plate_costs", { p_date: "2026-11-20" });
    expect(rpc.error?.code).toBe("42501");
    // The same owner at aal2 does see the invoice.
    const open = await ownerA.client.from("invoice").select("id");
    expect(open.data?.length).toBe(1);
  }, 120_000);

  it("(4) a backup factor works for the challenge; a third factor is refused", async () => {
    factors.owner.riserva = await enrol(ownerA.client, "riserva");
    const third = await send(ownerA.client, enrolRoute.POST as Handler, "/api/me/mfa/factors", {
      method: "POST",
      body: { slot: "riserva" },
    });
    expect(third.status).toBe(409);
    expect(["mfa_factor_limit", "mfa_slot_taken"]).toContain(third.error.code);
    const fresh = await signInJar(env!, venue.owner);
    expect((await challenge(fresh.client, factors.owner.riserva)).status).toBe(200);
    expect((await claimsOf(fresh.client)).aal).toBe("aal2");
  }, 180_000);

  it("(5) the lock: five wrong codes in a row, then 429 and no call reaches Supabase", async () => {
    factors.reserve = await enrol(reserveA.client, "principale");
    const fresh = await signInJar(env!, venue.adminReserve, counter.fetch);
    for (let i = 0; i < 5; i += 1) {
      const wrong = await send(
        fresh.client,
        challengeRoute.POST as Handler,
        "/api/auth/mfa/challenge",
        {
          method: "POST",
          body: { factorId: factors.reserve, code: "000000" },
        },
      );
      expect(wrong.status).toBe(422);
      expect(wrong.error.code).toBe("mfa_code_invalid");
    }
    const before = counter.calls;
    const locked = await send(
      fresh.client,
      challengeRoute.POST as Handler,
      "/api/auth/mfa/challenge",
      {
        method: "POST",
        body: { factorId: factors.reserve, code: "000000" },
      },
    );
    expect(locked.status).toBe(429);
    expect(locked.error.code).toBe("mfa_locked");
    expect(Number(locked.error.details?.retryAfterSeconds)).toBeGreaterThan(0);
    expect(counter.calls).toBe(before);
    // The right code is refused too while locked, and the status shows the lock.
    const correct = await challenge(fresh.client, factors.reserve);
    expect(correct.status).toBe(429);
    expect(
      (await get(fresh.client, statusRoute.GET as Handler, "/api/me/mfa")).body.lockedUntil,
    ).not.toBeNull();
    expect(
      runSql(
        `select count(*) from app.mfa_failure where app_user_id = ${quoteUuid(venue.adminReserve.appUserId)}`,
      ),
    ).toBe("5");
  }, 180_000);

  it("(7) rollout: required is refused until every admin has a factor, then accepted; a new admin is forced to enrol; off is the kill switch", async () => {
    // Admin Riserva has a factor, Admin Demo has none yet.
    const refused = await admin.rpc("set_mfa_enforcement", {
      p_tenant: venue.tenantId,
      p_mode: "required",
      p_actor: venue.adminReserve.appUserId,
    });
    expect(refused.error?.message).toBe("admins_not_enrolled");
    expect(JSON.parse(refused.error?.details ?? "{}")).toEqual({ count: 1 });

    factors.admin = await enrol(adminA.client, "principale");
    const accepted = await admin.rpc("set_mfa_enforcement", {
      p_tenant: venue.tenantId,
      p_mode: "required",
      p_actor: venue.adminReserve.appUserId,
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toEqual({ changed: true, mode: "required" });

    const added = await venue.addAdmin();
    const newcomer = await signInJar(env!, added);
    const forced = await get(newcomer.client, meRoute.GET as Handler, "/api/me");
    expect(forced.status).toBe(403);
    expect(forced.error.code).toBe("mfa_enrol_required");
    expect((await get(newcomer.client, statusRoute.GET as Handler, "/api/me/mfa")).body.gate).toBe(
      "enrol",
    );

    // The waiter and the chef are untouched under required.
    expect((await get(waiter.client, tablesRoute.GET as Handler, "/api/tables")).status).toBe(200);
    expect((await get(chef.client, meRoute.GET as Handler, "/api/me")).status).toBe(200);

    // The kill switch: an admin at aal1 with a factor reads again as soon as the mode is off.
    const aal1 = await signInJar(env!, venue.admin);
    expect((await get(aal1.client, meRoute.GET as Handler, "/api/me")).error.code).toBe(
      "mfa_required",
    );
    const off = await admin.rpc("set_mfa_enforcement", {
      p_tenant: venue.tenantId,
      p_mode: "off",
      p_actor: venue.adminReserve.appUserId,
    });
    expect(off.data).toEqual({ changed: true, mode: "off" });
    expect((await get(aal1.client, meRoute.GET as Handler, "/api/me")).status).toBe(200);
    await admin.rpc("set_mfa_enforcement", {
      p_tenant: venue.tenantId,
      p_mode: "enrolled",
      p_actor: venue.adminReserve.appUserId,
    });
    expect(
      runSql(
        `select count(*) from public.audit_event where action = 'tenant.mfa_enforcement_changed' and tenant_id = ${quoteUuid(venue.tenantId)}`,
      ),
    ).toBe("3");
  }, 240_000);

  it("(6) reset: DigiAlto's script removes the factors, signs the person out, and leaves the audit row; the app has no reset route", async () => {
    const lines: string[] = [];
    const errors: string[] = [];
    const exit = await runMfaReset(
      ["--user", venue.admin.appUserId, "--actor", venue.adminReserve.appUserId],
      {
        admin: () => admin as never,
        out: (line) => lines.push(line),
        err: (line) => errors.push(line),
      },
    );
    expect(errors).toEqual([]);
    expect(exit).toBe(0);
    expect(lines).toEqual([JSON.stringify({ removed: 1 })]);
    // The admin's sessions end (deleting a verified factor signs the user out everywhere).
    expect((await adminA.client.auth.refreshSession()).error).not.toBeNull();
    const list = await admin.auth.admin.mfa.listFactors({ userId: venue.admin.authId });
    expect(list.data?.factors).toEqual([]);
    expect(
      runSql(
        `select count(*) from public.audit_event where action = 'app_user.mfa_reset' and entity_id = ${quoteUuid(venue.admin.appUserId)}`,
      ),
    ).toBe("1");
    expect(
      runSql(
        `select created_by from public.audit_event where action = 'app_user.mfa_reset' and entity_id = ${quoteUuid(venue.admin.appUserId)}`,
      ),
    ).toBe(venue.adminReserve.appUserId);
    // Signed in again, the admin has no factor: enrolment is open again under enrolled.
    const again = await signInJar(env!, venue.admin);
    expect((await get(again.client, meRoute.GET as Handler, "/api/me")).status).toBe(200);
    const accounts = await get(again.client, accountsRoute.GET as Handler, "/api/mfa/accounts");
    expect(accounts.status).toBe(200);
  }, 120_000);

  it("(9) after all of it, no text or jsonb column of any app table holds a TOTP secret or a code that was used", () => {
    expect(secrets.length).toBeGreaterThanOrEqual(4);
    for (const table of appTables()) {
      const text = tableText(table);
      for (const secret of secrets) expect(text, table).not.toContain(secret);
      // A six-digit code is short enough to appear by chance in a number; look for it as a quoted value or a word on its own.
      for (const code of usedCodes)
        expect(text, table).not.toMatch(new RegExp(`["\\s:]${code}["\\s,}]`));
    }
  });
});
