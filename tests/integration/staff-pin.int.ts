import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AlertList } from "@/server/alerts/list";
import { derivePinPassword } from "@/server/staff-auth/derive";
import { CookieJar, countingFetch, createJarClient, deviceCookieFrom } from "./helpers/cookie-jar";
import { appTables, quoteUuid, runSql, runSqlWithoutTriggers, tableText } from "./helpers/sql";
import { createStack, readStackEnv, type Stack, type TestTenant } from "./helpers/stack";

// M11 acceptance tests 1 to 7 against the real local stack (GoTrue, PostgREST, the access token hook,
// pg guards). The route handlers run for real; only `createSupabaseServerClient` is replaced, so each call
// is handed either a signed-in test user's own client (owner routes) or a client over a cookie jar (the
// PIN device: production builds the client from cookies per request, and so does the jar helper).
//
// Rules this file keeps:
//  - what a user may read is asserted through that user's session (RLS applies), never the secret key;
//  - psql is used only for what the API cannot do (moving a clock column back, scanning all tables);
//  - every PIN, name and device is fake. The pepper is a fixed fake for the throwaway local stack.
//
// The tests run in order and share state. Sign-ins at Auth are kept low on purpose (the local limit is
// 30 per 5 minutes per IP): lock-outs are provoked with wrong PINs only where Auth is part of the proof,
// and the device lock uses unknown user ids, which fail inside Postgres before Auth.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const PEPPER = "test-pepper-not-a-secret-0123456789abcdef";
process.env.PIN_PEPPER = PEPPER;

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const usersRoute = await import("@/app/api/users/route");
const userRoute = await import("@/app/api/users/[id]/route");
const userPinRoute = await import("@/app/api/users/[id]/pin/route");
const devicesRoute = await import("@/app/api/devices/route");
const deviceRoute = await import("@/app/api/devices/[id]/route");
const unlockRoute = await import("@/app/api/devices/[id]/unlock/route");
const codesRoute = await import("@/app/api/devices/enrolment-codes/route");
const enrolRoute = await import("@/app/api/devices/enrol/route");
const deviceStatusRoute = await import("@/app/api/auth/device/route");
const pinRoute = await import("@/app/api/auth/pin/route");
const meRoute = await import("@/app/api/me/route");
const alertsRoute = await import("@/app/api/alerts/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  error: { code: string; message: string; details?: Record<string, unknown>[] };
  response: Response;
}

async function send<T = Record<string, unknown>>(
  client: SupabaseClient,
  handler: Handler,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): Promise<Reply<T>> {
  session.client = client;
  const method = init.method ?? "GET";
  const response = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { params: Promise.resolve(init.params ?? {}) },
  );
  const text = await response.text();
  const body = (text ? JSON.parse(text) : {}) as T;
  return {
    status: response.status,
    body,
    error: (body as { error?: Reply["error"] }).error as Reply["error"],
    response,
  };
}

const claimsOf = async (client: SupabaseClient): Promise<Record<string, unknown>> => {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No session in the jar");
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
};

const WAITER = { name: "Cameriere Demo", role: "waiter", pin: "4827" } as const;
const CHEF = { name: "Cuoco Demo", role: "chef", pin: "5931" } as const;
const NEW_PIN = "7046";
const WRONG_PIN = "1357";

describe.skipIf(!env)("staff PIN login on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  const counter = countingFetch();
  const waiterJar = new CookieJar();
  const chefJar = new CookieJar();
  const idle = new CookieJar();
  let owner: SupabaseClient;
  const ids = { waiter: "", chef: "" };
  let device1 = { id: "", cookie: "" };
  let device2 = { id: "", cookie: "" };
  let expiredCode = "";

  const jarClient = (jar: CookieJar) => createJarClient(env!, jar, counter.fetch);
  const ownerCall = <T = Record<string, unknown>>(
    handler: Handler,
    path: string,
    init: Parameters<typeof send>[3] = {},
  ) => send<T>(owner, handler, path, init);

  /** A PIN login from a device: its cookie, a jar for the session, the PIN route. */
  const login = (jar: CookieJar, cookie: string | null, userId: string, pin: string) =>
    send(jarClient(jar), pinRoute.POST as Handler, "/api/auth/pin", {
      method: "POST",
      body: { userId, pin },
      headers: cookie ? { cookie } : {},
    });

  const enrol = async (label: string) => {
    const code = await ownerCall<{ code: string }>(
      codesRoute.POST as Handler,
      "/api/devices/enrolment-codes",
      {
        method: "POST",
        body: { label },
      },
    );
    expect(code.status).toBe(201);
    const redeemed = await send(jarClient(idle), enrolRoute.POST as Handler, "/api/devices/enrol", {
      method: "POST",
      body: { code: code.body.code },
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    return { code: code.body.code, redeemed, cookie: deviceCookieFrom(redeemed.response) };
  };

  const deviceIdByLabel = async (label: string) => {
    const list = await ownerCall<{ devices: { id: string; label: string }[] }>(
      devicesRoute.GET as Handler,
      "/api/devices",
    );
    const device = list.body.devices.find((d) => d.label === label);
    if (!device) throw new Error(`No device ${label}`);
    return device.id;
  };

  const expireSessionsOf = (appUserId: string) =>
    runSqlWithoutTriggers(
      `update public.staff_session set ends_at = now() - interval '1 second'
        where app_user_id = ${quoteUuid(appUserId)} and ended_at is null`,
    );

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    owner = a.owner.client;
  }, 180_000);

  afterAll(() => {
    session.client = null;
  });

  describe("setup: staff and devices are created through the owner routes", () => {
    it("owner A creates Cameriere Demo and Cuoco Demo with PINs", async () => {
      for (const person of [WAITER, CHEF]) {
        const created = await ownerCall<{ user: { id: string; role: string } }>(
          usersRoute.POST as Handler,
          "/api/users",
          {
            method: "POST",
            body: { displayName: person.name, role: person.role, pin: person.pin },
          },
        );
        expect(created.status).toBe(201);
        expect(created.body.user.role).toBe(person.role);
        ids[person.role] = created.body.user.id;
      }
      expect(ids.waiter).not.toBe("");
      expect(ids.chef).not.toBe("");
    });

    it("a trivial PIN is refused with 422 (AT6)", async () => {
      const refused = await ownerCall(usersRoute.POST as Handler, "/api/users", {
        method: "POST",
        body: { displayName: "Cameriere Demo Due", role: "waiter", pin: "1234" },
      });
      expect(refused.status).toBe(422);
      expect(refused.error.code).toBe("pin_trivial");
    });

    it("a device is enrolled with a code, and only one that is shown once", async () => {
      const first = await enrol("Telefono sala (demo)");
      expect(first.redeemed.status).toBe(201);
      expect(first.cookie).toMatch(/^__Host-odr_device=/);
      device1 = { id: await deviceIdByLabel("Telefono sala (demo)"), cookie: first.cookie! };
      const second = await enrol("Tablet cucina (demo)");
      device2 = { id: await deviceIdByLabel("Tablet cucina (demo)"), cookie: second.cookie! };
      expect(device2.cookie).not.toBe(device1.cookie);
    });
  });

  describe("AT4: enrolment codes are single use and short lived", () => {
    it("a used code answers 410", async () => {
      const code = await ownerCall<{ code: string }>(
        codesRoute.POST as Handler,
        "/api/devices/enrolment-codes",
        {
          method: "POST",
          body: { label: "Telefono sala 2 (demo)" },
        },
      );
      const body = { code: code.body.code };
      const first = await send(jarClient(idle), enrolRoute.POST as Handler, "/api/devices/enrol", {
        method: "POST",
        body,
        headers: { "x-forwarded-for": "203.0.113.8" },
      });
      expect(first.status).toBe(201);
      const again = await send(jarClient(idle), enrolRoute.POST as Handler, "/api/devices/enrol", {
        method: "POST",
        body,
        headers: { "x-forwarded-for": "203.0.113.8" },
      });
      expect(again.status).toBe(410);
      expect(again.error.code).toBe("enrolment_code_used");
      expect(deviceCookieFrom(again.response)).toBeNull();
    });

    it("an expired code answers 410", async () => {
      const code = await ownerCall<{ code: string }>(
        codesRoute.POST as Handler,
        "/api/devices/enrolment-codes",
        {
          method: "POST",
          body: { label: "Scaduto (demo)" },
        },
      );
      expiredCode = code.body.code;
      runSqlWithoutTriggers(
        `update public.device_enrolment set expires_at = now() - interval '1 second' where label = 'Scaduto (demo)'`,
      );
      const late = await send(jarClient(idle), enrolRoute.POST as Handler, "/api/devices/enrol", {
        method: "POST",
        body: { code: expiredCode },
        headers: { "x-forwarded-for": "203.0.113.9" },
      });
      expect(late.status).toBe(410);
      expect(late.error.code).toBe("enrolment_code_expired");
    });

    it("an unknown code answers 404", async () => {
      const missing = await send(
        jarClient(idle),
        enrolRoute.POST as Handler,
        "/api/devices/enrol",
        {
          method: "POST",
          body: { code: "ZZZZZZZZ" },
          headers: { "x-forwarded-for": "203.0.113.10" },
        },
      );
      expect(missing.status).toBe(404);
    });
  });

  describe("AT1: a correct PIN on an enrolled device opens a session with the role and tenant", () => {
    it("the device lists its staff by name and role", async () => {
      const status = await send<{
        enrolled: boolean;
        staff: { displayName: string; role: string }[];
      }>(jarClient(idle), deviceStatusRoute.GET as Handler, "/api/auth/device", {
        headers: { cookie: device1.cookie },
      });
      expect(status.body.enrolled).toBe(true);
      expect(status.body.staff.map((s) => s.displayName).sort()).toEqual([CHEF.name, WAITER.name]);
      expect(Object.keys(status.body.staff[0]!).sort()).toEqual(["displayName", "id", "role"]);
    });

    it("the waiter logs in: claims carry tenant A, waiter and login pin; /api/me says waiter", async () => {
      const reply = await login(waiterJar, device1.cookie, ids.waiter, WAITER.pin);
      expect(reply.status).toBe(200);
      const claims = await claimsOf(jarClient(waiterJar));
      expect(claims).toMatchObject({ tenant_id: a.id, app_role: "waiter", login: "pin" });
      const me = await send<{ user: { role: string; displayName: string } }>(
        jarClient(waiterJar),
        meRoute.GET as Handler,
        "/api/me",
      );
      expect(me.status).toBe(200);
      expect(me.body.user).toMatchObject({ role: "waiter", displayName: WAITER.name });
    });

    it("the chef logs in the same way with role chef", async () => {
      const reply = await login(chefJar, device1.cookie, ids.chef, CHEF.pin);
      expect(reply.status).toBe(200);
      expect(await claimsOf(jarClient(chefJar))).toMatchObject({
        tenant_id: a.id,
        app_role: "chef",
      });
      const me = await send<{ user: { role: string } }>(
        jarClient(chefJar),
        meRoute.GET as Handler,
        "/api/me",
      );
      expect(me.body.user.role).toBe("chef");
    });

    it("a hook bypass fails: a direct sign-in with the right derived password yields no tenant", async () => {
      // No pending attempt exists, so the access token hook must not add the tenant claims.
      const email = runSql(
        `select au.email from auth.users au join public.app_user u on u.auth_id = au.id where u.id = ${quoteUuid(ids.waiter)}`,
      );
      const direct = jarClient(new CookieJar());
      const { data, error } = await direct.auth.signInWithPassword({
        email,
        password: derivePinPassword(PEPPER, ids.waiter, WAITER.pin),
      });
      expect(error).toBeNull();
      const claims = JSON.parse(
        Buffer.from(data.session!.access_token.split(".")[1]!, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      expect(claims.tenant_id).toBeUndefined();
      expect(claims.app_role).toBeUndefined();
      expect(claims.session_state).toBe("ended");
    });
  });

  describe("email users are unaffected, and tenants stay apart", () => {
    it("the email chef and waiter still read their own rows through RLS", async () => {
      for (const user of [a.chef, a.waiter]) {
        const me = await send<{ user: { role: string } }>(
          user.client,
          meRoute.GET as Handler,
          "/api/me",
        );
        expect(me.status).toBe(200);
        expect(me.body.user.role).toBe(user.role);
      }
    });

    it("owner B sees none of A's devices or staff", async () => {
      const devices = await send<{ devices: unknown[]; pendingCodes: unknown[] }>(
        b.owner.client,
        devicesRoute.GET as Handler,
        "/api/devices",
      );
      expect(devices.body.devices).toEqual([]);
      const staff = await send<{ staff: { id: string }[] }>(
        b.owner.client,
        usersRoute.GET as Handler,
        "/api/users",
      );
      expect(staff.body.staff.map((s) => s.id)).not.toContain(ids.waiter);
      expect(staff.body.staff.map((s) => s.id)).not.toContain(ids.chef);
    });

    it("chef and waiter cannot use the owner routes", async () => {
      for (const user of [a.chef, a.waiter]) {
        const reply = await send(user.client, devicesRoute.GET as Handler, "/api/devices");
        expect(reply.status).toBe(403);
      }
    });
  });

  describe("AT7: a session ends when Postgres says so", () => {
    it("past its end, the next service call is 401 session_ended (chef, RPC path)", async () => {
      expireSessionsOf(ids.chef);
      const me = await send(jarClient(chefJar), meRoute.GET as Handler, "/api/me");
      expect(me.status).toBe(401);
      expect(me.error.code).toBe("session_ended");
    });

    it("a refresh after the end returns a token with no tenant and session_state ended (waiter)", async () => {
      expireSessionsOf(ids.waiter);
      const client = jarClient(waiterJar);
      const { data, error } = await client.auth.refreshSession();
      expect(error).toBeNull();
      const claims = JSON.parse(
        Buffer.from(data.session!.access_token.split(".")[1]!, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      expect(claims.tenant_id).toBeUndefined();
      expect(claims.session_state).toBe("ended");
      const me = await send(jarClient(waiterJar), meRoute.GET as Handler, "/api/me");
      expect(me.status).toBe(401);
      expect(me.error.code).toBe("session_ended");
    });
  });

  describe("AT2: nothing reaches Supabase Auth without a valid device", () => {
    it("no device cookie -> 401 and no token request", async () => {
      counter.reset();
      const reply = await login(new CookieJar(), null, ids.waiter, WAITER.pin);
      expect(reply.status).toBe(401);
      expect(reply.error.code).toBe("device_missing");
      expect(counter.tokenRequests).toBe(0);
    });

    it("a revoked device -> 401 and no token request", async () => {
      const revoked = await ownerCall<{ device: { status: string } }>(
        deviceRoute.DELETE as Handler,
        `/api/devices/${device2.id}`,
        {
          method: "DELETE",
          params: { id: device2.id },
          body: {},
        },
      );
      expect(revoked.status).toBe(200);
      expect(revoked.body.device.status).toBe("revocato");
      counter.reset();
      const reply = await login(new CookieJar(), device2.cookie, ids.waiter, WAITER.pin);
      expect(reply.status).toBe(401);
      expect(reply.error.code).toBe("device_revoked");
      expect(counter.tokenRequests).toBe(0);
      const status = await send<{ enrolled: boolean }>(
        jarClient(idle),
        deviceStatusRoute.GET as Handler,
        "/api/auth/device",
        {
          headers: { cookie: device2.cookie },
        },
      );
      expect(status.body.enrolled).toBe(false);
    });
  });

  describe("AT3: lockouts", () => {
    it("5 wrong PINs lock the user; the 6th, even correct, never reaches Auth", async () => {
      const left: unknown[] = [];
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const reply = await login(new CookieJar(), device1.cookie, ids.waiter, WRONG_PIN);
        expect(reply.status).toBe(401);
        expect(reply.error.code).toBe("pin_invalid");
        left.push(reply.error.details?.[0]?.attemptsLeft);
      }
      expect(left).toEqual([4, 3, 2, 1]);
      const fifth = await login(new CookieJar(), device1.cookie, ids.waiter, WRONG_PIN);
      expect(fifth.status).toBe(423);
      expect(fifth.error.code).toBe("user_locked");
      counter.reset();
      const sixth = await login(new CookieJar(), device1.cookie, ids.waiter, WAITER.pin);
      expect(sixth.status).toBe(423);
      expect(sixth.error.code).toBe("user_locked");
      expect(counter.tokenRequests).toBe(0);
    });

    it("20 failures on a device lock it, end its sessions and raise one owner alert", async () => {
      // 5 failures are already on device 1 (above). 14 unknown ids add 14 and answer like a wrong PIN;
      // the 15th is the 20th failure. Unknown ids fail inside Postgres, so Auth is not asked.
      counter.reset();
      const outcomes: string[] = [];
      for (let attempt = 1; attempt <= 15; attempt += 1) {
        const unknown = `00000000-0000-4000-8000-${String(attempt).padStart(12, "0")}`;
        const reply = await login(new CookieJar(), device1.cookie, unknown, WRONG_PIN);
        outcomes.push(reply.error.code);
      }
      expect(outcomes.slice(0, 14).every((code) => code === "pin_invalid")).toBe(true);
      expect(outcomes[14]).toBe("device_locked");
      expect(counter.tokenRequests).toBe(0);

      const blocked = await login(new CookieJar(), device1.cookie, ids.chef, CHEF.pin);
      expect(blocked.status).toBe(423);
      expect(blocked.error.code).toBe("device_locked");
      expect(counter.tokenRequests).toBe(0);

      const alerts = await send<AlertList>(owner, alertsRoute.GET as Handler, "/api/alerts");
      const locked = alerts.body.alerts.filter((alert) => alert.kind === "device_locked");
      expect(locked).toHaveLength(1);
      expect(locked[0]!.title).toContain("Telefono sala (demo)");
      for (const user of [a.admin, a.chef]) {
        const seen = await send<AlertList>(user.client, alertsRoute.GET as Handler, "/api/alerts");
        const kinds = seen.status === 200 ? seen.body.alerts.map((alert) => alert.kind) : [];
        expect(kinds).not.toContain("device_locked");
      }
    });

    it("the owner unlocks the device", async () => {
      const unlocked = await ownerCall<{ device: { status: string } }>(
        unlockRoute.POST as Handler,
        `/api/devices/${device1.id}/unlock`,
        {
          method: "POST",
          params: { id: device1.id },
          body: {},
        },
      );
      expect(unlocked.status).toBe(200);
      expect(unlocked.body.device.status).toBe("attivo");
    });
  });

  describe("AT6: after a PIN reset the old PIN fails", () => {
    it("the reset ends the chef's earlier session and the old PIN no longer works", async () => {
      // A fresh chef session first, so there is something for the reset to end.
      const fresh = new CookieJar();
      expect((await login(fresh, device1.cookie, ids.chef, CHEF.pin)).status).toBe(200);
      expect((await send(jarClient(fresh), meRoute.GET as Handler, "/api/me")).status).toBe(200);

      expect(
        (
          await ownerCall(userPinRoute.POST as Handler, `/api/users/${ids.chef}/pin`, {
            method: "POST",
            params: { id: ids.chef },
            body: { pin: "1234" },
          })
        ).status,
      ).toBe(422);
      const reset = await ownerCall(userPinRoute.POST as Handler, `/api/users/${ids.chef}/pin`, {
        method: "POST",
        params: { id: ids.chef },
        body: { pin: NEW_PIN },
      });
      expect(reset.status).toBe(204);

      const ended = await send(jarClient(fresh), meRoute.GET as Handler, "/api/me");
      expect(ended.status).toBe(401);
      expect(ended.error.code).toBe("session_ended");
      const old = await login(new CookieJar(), device1.cookie, ids.chef, CHEF.pin);
      expect(old.status).toBe(401);
      expect(old.error.code).toBe("pin_invalid");
      expect((await login(new CookieJar(), device1.cookie, ids.chef, NEW_PIN)).status).toBe(200);
    });

    it("a reset also unlocks a locked user (the waiter, locked in AT3)", async () => {
      const reset = await ownerCall(userPinRoute.POST as Handler, `/api/users/${ids.waiter}/pin`, {
        method: "POST",
        params: { id: ids.waiter },
        body: { pin: NEW_PIN },
      });
      expect(reset.status).toBe(204);
      const old = await login(new CookieJar(), device1.cookie, ids.waiter, WAITER.pin);
      expect(old.status).toBe(401);
      expect(old.error.code).toBe("pin_invalid");
      expect((await login(new CookieJar(), device1.cookie, ids.waiter, NEW_PIN)).status).toBe(200);
    });
  });

  describe("deactivation ends access at once", () => {
    it("a deactivated person cannot log in (no Auth call) and can again after reactivation", async () => {
      const off = await ownerCall<{ user: { active: boolean } }>(
        userRoute.PATCH as Handler,
        `/api/users/${ids.waiter}`,
        {
          method: "PATCH",
          params: { id: ids.waiter },
          body: { active: false },
        },
      );
      expect(off.status).toBe(200);
      expect(off.body.user.active).toBe(false);
      counter.reset();
      const refused = await login(new CookieJar(), device1.cookie, ids.waiter, NEW_PIN);
      expect(refused.status).toBe(401);
      expect(counter.tokenRequests).toBe(0);
      const on = await ownerCall(userRoute.PATCH as Handler, `/api/users/${ids.waiter}`, {
        method: "PATCH",
        params: { id: ids.waiter },
        body: { active: true },
      });
      expect(on.status).toBe(200);
    });
  });

  describe("Q10: the owner sees no per-person login times", () => {
    it("the owner staff and device answers carry no login or logout time of a person", async () => {
      const staff = await ownerCall(usersRoute.GET as Handler, "/api/users");
      const people = JSON.stringify(staff.body);
      expect(people).not.toMatch(/login(At|Time)|logout|lastLogin|session|started/i);
      const devices = await ownerCall(devicesRoute.GET as Handler, "/api/devices");
      expect(JSON.stringify(devices.body)).not.toMatch(/logout|session|attempt|userId/i);
    });
  });

  describe("AT5: no PIN, and nothing derived from one, is stored in an app table", () => {
    it("a scan of every public and app table finds no PIN value and no derived password", () => {
      const pins = [WAITER.pin, CHEF.pin, NEW_PIN];
      const secrets: string[] = [];
      for (const [id, pin] of [
        [ids.waiter, WAITER.pin],
        [ids.waiter, NEW_PIN],
        [ids.chef, CHEF.pin],
        [ids.chef, NEW_PIN],
      ] as const) {
        const password = derivePinPassword(PEPPER, id, pin);
        secrets.push(password, Buffer.from(password, "base64url").toString("hex"));
      }
      const tables = appTables();
      expect(tables).toEqual(
        expect.arrayContaining([
          "public.auth_attempt",
          "public.staff_session",
          "public.venue_device",
        ]),
      );
      for (const table of tables) {
        const text = tableText(table);
        for (const pin of pins) {
          // A PIN standing alone as a value; digits inside ids, timestamps and hashes do not count.
          expect(text, `${table} holds ${pin}`).not.toMatch(
            new RegExp(`(?<![0-9A-Za-z.:+-])${pin}(?![0-9A-Za-z.:+-])`),
          );
        }
        for (const secret of secrets)
          expect(text, `${table} holds a derived value`).not.toContain(secret);
      }
    });
  });
});
