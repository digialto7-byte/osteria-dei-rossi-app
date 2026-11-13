import { randomInt, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { derivePinPassword } from "@/server/staff-auth/derive";
import { latestCodeFor } from "./helpers/auth-mail";
import { CookieJar, createJarClient } from "./helpers/cookie-jar";
import { readStackEnv } from "./helpers/stack";

// M25a step 10 (plan §5): owner and admin sign-in with a password, the e-mail code, the password change and the
// 30-day cap's inputs, against the real local stack (GoTrue with the Italian templates, Mailpit, the access token
// hook). The route handlers run for real; only `createSupabaseServerClient` is replaced, so each call is handed a
// client over a cookie jar, the way production builds one per request.
//
// Proves the technical unknowns of the plan: T2 (the `amr` entries of a code sign-in; the timestamp survives a
// refresh), T3 (the PKCE e-mail's token is accepted by verifyOtp type "email"), T8 (signOut "others" ends the other
// sessions). Every address is @example.test, every password is made at run time, nothing is stored.
//
// Budget: Auth's sign-in bucket (`sign_in_sign_ups`, 30 per 5 minutes per IP) is shared with the other suites and
// Playwright, so the suite makes at most 8 grant_type=password calls; the last test asserts it.
const env = readStackEnv();
const MAILPIT_URL = process.env.E2E_MAILPIT_URL;
if (env && process.env.CI && !MAILPIT_URL) throw new Error("E2E_MAILPIT_URL must be set in CI");

const PEPPER = "test-pepper-not-a-secret-0123456789abcdef";
process.env.PIN_PEPPER = PEPPER;

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const passwordRoute = await import("@/app/api/auth/password/route");
const emailCodeRoute = await import("@/app/api/auth/email-code/route");
const magicLinkRoute = await import("@/app/api/auth/magic-link/route");
const mePasswordRoute = await import("@/app/api/me/password/route");
const meRoute = await import("@/app/api/me/route");
const usersRoute = await import("@/app/api/users/route");

type Handler = (request: Request) => Promise<Response>;

interface Reply {
  status: number;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  error: { code: string; message: string; details?: Record<string, unknown> };
}

async function send(
  client: SupabaseClient,
  handler: Handler,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Reply> {
  session.client = client;
  const method = init.method ?? "GET";
  const response = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { status: response.status, body, error: body.error };
}

interface Claims {
  app_role?: string;
  amr: { method: string; timestamp: number }[];
}

/** The decoded access-token claims of the session held in a jar. */
async function claimsOf(client: SupabaseClient): Promise<Claims> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No session in the jar");
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

/** Counts the password grants that reach Auth through the jar clients. */
function passwordGrantCounter() {
  const counter = {
    calls: 0,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/auth/v1/token") && url.includes("grant_type=password")) counter.calls += 1;
      return fetch(input, init);
    }) as typeof fetch,
  };
  return counter;
}

const LINK_METHODS = ["otp", "magiclink", "email", "recovery", "invite"];

describe.skipIf(!env || !MAILPIT_URL)("owner password sign-in on the real stack", () => {
  const counter = passwordGrantCounter();
  const jarClient = (jar: CookieJar) => createJarClient(env!, jar, counter.fetch);

  const email = `owner+${randomUUID().slice(0, 8)}@example.test`;
  const firstPassword = `prima ${randomUUID()}`;
  const newPassword = `frase di prova ${randomUUID()}`;
  const oldJar = new CookieJar();
  const codeJar = new CookieJar();
  const freshJar = new CookieJar();
  const pinJar = new CookieJar();
  let admin: SupabaseClient;
  let amrAtSignIn: { method: string; timestamp: number }[] = [];

  beforeAll(async () => {
    admin = createClient(env!.url, env!.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const created = await admin.auth.admin.createUser({
      email,
      password: firstPassword,
      email_confirm: true,
    });
    const authId = created.data.user?.id;
    if (created.error || !authId) throw new Error("Fixture failed: owner user");
    const tenant = await admin.rpc("create_tenant_with_owner", {
      tenant_name: "Osteria Demo",
      tenant_vat_number: `IT${String(randomInt(0, 1e11)).padStart(11, "0")}`,
      owner_auth_id: authId,
      owner_display_name: "Titolare Demo",
    });
    if (tenant.error) throw new Error(`Fixture failed: tenant: ${tenant.error.message}`);
  }, 120_000);

  afterAll(() => {
    session.client = null;
  });

  it("(f) a wrong password gets 401 login_invalid, the same as an unknown address", async () => {
    const wrong = await send(
      jarClient(new CookieJar()),
      passwordRoute.POST as Handler,
      "/api/auth/password",
      {
        method: "POST",
        body: { email, password: "una password sbagliata" },
      },
    );
    expect(wrong.status).toBe(401);
    expect(wrong.error.code).toBe("login_invalid");
  });

  it("a password sign-in gives owner claims and the Oggi redirect (the earlier session of (c))", async () => {
    const signedIn = await send(
      jarClient(oldJar),
      passwordRoute.POST as Handler,
      "/api/auth/password",
      {
        method: "POST",
        body: { email, password: firstPassword },
      },
    );
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toEqual({ redirect: "/" });
    const claims = await claimsOf(jarClient(oldJar));
    expect(claims.app_role).toBe("owner");
    expect(claims.amr[0]?.method).toBe("password");
  });

  it("(a, T3) the link e-mail holds a 6-digit code and verifyOtp accepts it", async () => {
    const requested = await send(
      jarClient(codeJar),
      magicLinkRoute.POST as Handler,
      "/api/auth/magic-link",
      {
        method: "POST",
        body: { email },
      },
    );
    expect(requested.status).toBe(202);
    const code = await latestCodeFor(MAILPIT_URL!, email);
    expect(code).toMatch(/^\d{6}$/);

    const signedIn = await send(
      jarClient(codeJar),
      emailCodeRoute.POST as Handler,
      "/api/auth/email-code",
      {
        method: "POST",
        body: { email, code },
      },
    );
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toEqual({ redirect: "/password?dopo=%2F" });
    expect(codeJar.getAll().some((c) => c.name.startsWith("sb-"))).toBe(true);

    const me = await send(jarClient(codeJar), meRoute.GET as Handler, "/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("owner");
  });

  it("a wrong code gets 422 code_invalid", async () => {
    const refused = await send(
      jarClient(new CookieJar()),
      emailCodeRoute.POST as Handler,
      "/api/auth/email-code",
      {
        method: "POST",
        body: { email, code: "000000" },
      },
    );
    expect(refused.status).toBe(422);
    expect(refused.error.code).toBe("code_invalid");
  });

  it("(b, T2) the code session is a link session, and its amr timestamp survives a refresh", async () => {
    const claims = await claimsOf(jarClient(codeJar));
    amrAtSignIn = claims.amr;
    // Recorded for the plan's T2: the real method names of a code sign-in.
    console.warn(
      `T2 amr of a code sign-in: ${JSON.stringify(claims.amr.map((e: { method: string }) => e.method))}`,
    );
    expect(LINK_METHODS).toContain(claims.amr[0]?.method);

    const refreshed = await jarClient(codeJar).auth.refreshSession();
    expect(refreshed.error).toBeNull();
    const after = await claimsOf(jarClient(codeJar));
    expect(after.amr.map((e: { timestamp: number }) => e.timestamp)).toEqual(
      amrAtSignIn.map((e) => e.timestamp),
    );
  });

  it("GET /api/me/password reads a recent link sign-in", async () => {
    const status = await send(
      jarClient(codeJar),
      mePasswordRoute.GET as Handler,
      "/api/me/password",
    );
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ signInMethod: "link", recentSignIn: true, minLength: 10 });
  });

  it("(d) a 9-character password is refused by Auth itself (the local minimum is 10)", async () => {
    const { error } = await jarClient(codeJar).auth.updateUser({ password: "abcdefghi" });
    expect(error?.code).toBe("weak_password");
  });

  it("the route refuses a common password before Auth", async () => {
    const refused = await send(
      jarClient(codeJar),
      mePasswordRoute.POST as Handler,
      "/api/me/password",
      {
        method: "POST",
        body: { newPassword: "basketball" },
      },
    );
    expect(refused.status).toBe(422);
    expect(refused.error.details).toEqual({ reason: "common" });
  });

  it("(c, T8) a recent session sets a password; the earlier session ends; the new password works and the old one does not", async () => {
    const saved = await send(
      jarClient(codeJar),
      mePasswordRoute.POST as Handler,
      "/api/me/password",
      {
        method: "POST",
        body: { newPassword },
      },
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ status: "saved", mfa: "none" });

    // This device is now a password session.
    const here = await claimsOf(jarClient(codeJar));
    expect(here.amr.some((e: { method: string }) => e.method === "password")).toBe(true);

    // The session from before the change cannot refresh any more.
    const refreshed = await jarClient(oldJar).auth.refreshSession();
    expect(refreshed.error).not.toBeNull();

    const fresh = await send(
      jarClient(freshJar),
      passwordRoute.POST as Handler,
      "/api/auth/password",
      {
        method: "POST",
        body: { email, password: newPassword },
      },
    );
    expect(fresh.status).toBe(200);
    const old = await send(
      jarClient(new CookieJar()),
      passwordRoute.POST as Handler,
      "/api/auth/password",
      {
        method: "POST",
        body: { email, password: firstPassword },
      },
    );
    expect(old.status).toBe(401);
    expect(old.error.code).toBe("login_invalid");
  });

  it("(e) a PIN account's derived password signs in at Auth but gets no tenant: 401 session_ended", async () => {
    const created = await send(jarClient(freshJar), usersRoute.POST as Handler, "/api/users", {
      method: "POST",
      body: { displayName: "Cameriere Demo", role: "waiter", pin: "4827" },
    });
    expect(created.status).toBe(201);
    const id = created.body.user.id as string;

    const signedIn = await send(
      jarClient(pinJar),
      passwordRoute.POST as Handler,
      "/api/auth/password",
      {
        method: "POST",
        body: {
          email: `staff-${id}@staff.invalid`,
          password: derivePinPassword(PEPPER, id, "4827"),
        },
      },
    );
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toEqual({ redirect: "/" });

    const me = await send(jarClient(pinJar), meRoute.GET as Handler, "/api/me");
    expect(me.status).toBe(401);
    expect(me.error.code).toBe("session_ended");
  });

  it("the suite stayed within its budget of 8 password grants", () => {
    expect(counter.calls).toBeGreaterThan(0);
    expect(counter.calls).toBeLessThanOrEqual(8);
  });
});
