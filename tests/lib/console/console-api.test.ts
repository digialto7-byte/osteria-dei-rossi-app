import { describe, expect, it, vi } from "vitest";
import {
  SWITCH_KEY,
  consoleApi,
  consoleLogout,
  isConsoleDown,
  resetConsoleSwitch,
  type ConsoleFailure,
} from "@/lib/console/console-api";
import { needsFullLoad } from "@/lib/nav/full-load";

type Reply = { status: number; body?: unknown } | "network";
type Call = { path: string; method: string; body: unknown };

function setup(
  replies: Record<string, Reply[]>,
  where = { pathname: "/registro", search: "?dal=2026-11-01" },
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const reply = replies[path]?.shift();
    if (reply === undefined) throw new Error(`no reply queued for ${path}`);
    if (reply === "network") throw new TypeError("offline");
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const store = new Map<string, string>();
  const session = {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn((k: string) => void store.delete(k)),
  };
  const location = { ...where, assign: vi.fn(), reload: vi.fn(), replace: vi.fn() };
  return { calls, env: { fetchImpl, session, location }, session, store, location };
}
const err = (status: number, code: string) => ({
  status,
  body: { error: { code, message: `msg ${code}` } },
});
const ok = (body: unknown = {}) => ({ status: 200, body });
const failure = (r: unknown) => r as ConsoleFailure;

describe("the console mode switch (409 console_selection_required)", () => {
  it("posts {} to /api/platform/console once, then reloads, and returns leaving: true", async () => {
    const { calls, env, location, store } = setup({
      "/api/platform/me": [err(409, "console_selection_required")],
      "/api/platform/console": [ok({ mode: "console" })],
    });
    const result = failure(await consoleApi("/api/platform/me", {}, env));
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["GET", "/api/platform/me", undefined],
      ["POST", "/api/platform/console", {}],
    ]);
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, status: 409, leaving: true });
    expect(store.get(SWITCH_KEY)).toBe("1");
  });

  it("makes one POST and one reload for two parallel 409s", async () => {
    const { calls, env, location } = setup({
      "/api/platform/me": [err(409, "console_selection_required")],
      "/api/platform/tenants": [err(409, "console_selection_required")],
      "/api/platform/console": [ok({ mode: "console" })],
    });
    const [a, b] = await Promise.all([
      consoleApi("/api/platform/me", {}, env),
      consoleApi("/api/platform/tenants", {}, env),
    ]);
    expect(calls.filter((c) => c.path === "/api/platform/console")).toHaveLength(1);
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(failure(a).leaving).toBe(true);
    expect(failure(b).leaving).toBe(true);
  });

  it("with the key already set makes no POST and reports console_unavailable, not leaving", async () => {
    const { calls, env, location, store } = setup({
      "/api/platform/me": [err(409, "console_selection_required")],
    });
    store.set(SWITCH_KEY, "1");
    const result = failure(await consoleApi("/api/platform/me", {}, env));
    expect(calls).toHaveLength(1);
    expect(location.reload).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      leaving: false,
      error: { code: "console_unavailable", message: "La console non risponde. Riprova tra poco." },
    });
  });

  it("returns the 503 console_switch_failed, no reload, and lets a later call try again", async () => {
    const { env, location, store } = setup({
      "/api/platform/me": [
        err(409, "console_selection_required"),
        err(409, "console_selection_required"),
      ],
      "/api/platform/console": [err(503, "console_switch_failed"), ok({ mode: "console" })],
    });
    const first = failure(await consoleApi("/api/platform/me", {}, env));
    expect(first).toMatchObject({
      status: 503,
      leaving: false,
      error: { code: "console_switch_failed" },
    });
    expect(isConsoleDown(first)).toBe(true);
    expect(location.reload).not.toHaveBeenCalled();
    expect(store.has(SWITCH_KEY)).toBe(false);
    const second = failure(await consoleApi("/api/platform/me", {}, env));
    expect(second.leaving).toBe(true);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("returns a network failure of the POST, with no reload", async () => {
    const { env, location } = setup({
      "/api/platform/me": [err(409, "console_selection_required")],
      "/api/platform/console": ["network"],
    });
    const result = failure(await consoleApi("/api/platform/me", {}, env));
    expect(result).toMatchObject({ status: 0, leaving: false });
    expect(isConsoleDown(result)).toBe(true);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("goes to the enrolment page when the POST answers mfa_factor_required", async () => {
    const { env, location } = setup({
      "/api/platform/me": [err(409, "console_selection_required")],
      "/api/platform/console": [err(403, "mfa_factor_required")],
    });
    const result = failure(await consoleApi("/api/platform/me", {}, env));
    expect(result.leaving).toBe(true);
    expect(location.assign).toHaveBeenCalledTimes(1);
  });
});

describe("success", () => {
  it("clears the key and returns the data", async () => {
    const { env, session, store } = setup({
      "/api/platform/me": [ok({ displayName: "DigiAlto", unreadNotices: 1 })],
    });
    store.set(SWITCH_KEY, "1");
    const result = await consoleApi("/api/platform/me", {}, env);
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { displayName: "DigiAlto", unreadNotices: 1 },
    });
    expect(session.removeItem).toHaveBeenCalledWith(SWITCH_KEY);
    expect(store.has(SWITCH_KEY)).toBe(false);
  });

  it("sends no body on a GET and JSON on a POST", async () => {
    const { calls, env } = setup({
      "/api/platform/tenants": [ok({ tenants: [] })],
      "/api/platform/notices/n1/notified": [
        ok({ notifiedAt: "2026-11-15T09:00:00Z", changed: true }),
      ],
    });
    await consoleApi("/api/platform/tenants", {}, env);
    await consoleApi(
      "/api/platform/notices/n1/notified",
      { method: "POST", body: { tenantId: "t1" } },
      env,
    );
    expect(calls[0]).toEqual({ path: "/api/platform/tenants", method: "GET", body: undefined });
    expect(calls[1]).toEqual({
      path: "/api/platform/notices/n1/notified",
      method: "POST",
      body: { tenantId: "t1" },
    });
  });

  it("never writes anything to storage except the switch key", async () => {
    const { env, session } = setup({
      "/api/platform/me": [err(409, "console_selection_required")],
      "/api/platform/console": [ok()],
    });
    await consoleApi("/api/platform/me", {}, env);
    expect(session.setItem.mock.calls).toEqual([[SWITCH_KEY, "1"]]);
  });
});

describe("other replies", () => {
  it("403 mfa_factor_required assigns the enrolment page with a way back, as a full load", async () => {
    const { env, location } = setup({
      "/api/platform/audit?dal=2026-11-01": [err(403, "mfa_factor_required")],
    });
    const result = failure(await consoleApi("/api/platform/audit?dal=2026-11-01", {}, env));
    expect(result.leaving).toBe(true);
    const href = location.assign.mock.calls[0]![0] as string;
    expect(href).toBe("/login/attiva-codice?next=%2Fregistro%3Fdal%3D2026-11-01");
    expect(needsFullLoad(href)).toBe(true);
    expect(location.replace).not.toHaveBeenCalled();
  });

  it("401 unauthenticated assigns /login with a way back", async () => {
    const { env, location } = setup({ "/api/platform/me": [err(401, "unauthenticated")] });
    const result = failure(await consoleApi("/api/platform/me", {}, env));
    expect(result.leaving).toBe(true);
    expect(location.assign).toHaveBeenCalledWith("/login?next=%2Fregistro%3Fdal%3D2026-11-01");
  });

  it("403 mfa_required and 401 session_expired are leaving, with no navigation of their own", async () => {
    const { env, location } = setup({
      "/api/platform/me": [err(403, "mfa_required"), err(401, "session_expired")],
    });
    expect(failure(await consoleApi("/api/platform/me", {}, env)).leaving).toBe(true);
    expect(failure(await consoleApi("/api/platform/me", {}, env)).leaving).toBe(true);
    expect(location.assign).not.toHaveBeenCalled();
    expect(location.replace).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("returns 403 forbidden and 404 tenant_not_found as plain failures", async () => {
    const { env, location } = setup({
      "/api/platform/me": [err(403, "forbidden")],
      "/api/platform/tenants/x": [err(404, "tenant_not_found")],
    });
    expect(failure(await consoleApi("/api/platform/me", {}, env))).toMatchObject({
      status: 403,
      leaving: false,
      error: { code: "forbidden" },
    });
    expect(failure(await consoleApi("/api/platform/tenants/x", {}, env))).toMatchObject({
      status: 404,
      leaving: false,
    });
    expect(location.assign).not.toHaveBeenCalled();
  });
});

describe("isConsoleDown", () => {
  const f = (status: number, code = "x"): ConsoleFailure => ({
    ok: false,
    status,
    error: { code, message: "m" },
    leaving: false,
  });
  it("is true for a network failure, 500, 502, 503 and bad_response", () => {
    for (const s of [0, 500, 502, 503]) expect(isConsoleDown(f(s)), String(s)).toBe(true);
    expect(isConsoleDown(f(200, "bad_response"))).toBe(true);
  });
  it("is false for the rest", () => {
    for (const s of [400, 401, 403, 404, 409, 429])
      expect(isConsoleDown(f(s)), String(s)).toBe(false);
  });
});

describe("consoleLogout", () => {
  it("posts /api/platform/logout then replaces with /login", async () => {
    const { calls, env, location, store } = setup({ "/api/platform/logout": [ok({ ok: true })] });
    store.set(SWITCH_KEY, "1");
    expect(await consoleLogout(env)).toBeNull();
    expect(calls).toEqual([{ path: "/api/platform/logout", method: "POST", body: {} }]);
    expect(location.replace).toHaveBeenCalledWith("/login");
    expect(store.has(SWITCH_KEY)).toBe(false);
  });
  it("returns a network failure without navigating", async () => {
    const { env, location } = setup({ "/api/platform/logout": ["network"] });
    const result = await consoleLogout(env);
    expect(result).toMatchObject({ ok: false, status: 0 });
    expect(location.replace).not.toHaveBeenCalled();
  });
});

describe("a switch that did not bring console mode (the guard after a reload)", () => {
  const nine = err(409, "console_selection_required");

  it("reports console_unavailable and clears the stored key, so it cannot stay stuck", async () => {
    const { env, store } = setup({ "/api/platform/me": [nine] });
    store.set(SWITCH_KEY, "1");
    const result = failure(await consoleApi("/api/platform/me", {}, env));
    expect(result.error.code).toBe("console_unavailable");
    expect(store.has(SWITCH_KEY)).toBe(false);
  });

  it("parallel 409s after the reload report twice and POST never (no loop)", async () => {
    const { calls, env, store, location } = setup({
      "/api/platform/me": [nine],
      "/api/platform/tenants": [nine],
    });
    store.set(SWITCH_KEY, "1");
    const [a, b] = await Promise.all([
      consoleApi("/api/platform/me", {}, env),
      consoleApi("/api/platform/tenants", {}, env),
    ]);
    expect(failure(a).error.code).toBe("console_unavailable");
    expect(failure(b).error.code).toBe("console_unavailable");
    expect(calls.filter((c) => c.path === "/api/platform/console")).toHaveLength(0);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("a follow-up automatic 409 in the same document after the report does not POST", async () => {
    const { calls, env, store } = setup({ "/api/platform/me": [nine, nine] });
    store.set(SWITCH_KEY, "1");
    await consoleApi("/api/platform/me", {}, env);
    await consoleApi("/api/platform/me", {}, env);
    expect(calls.filter((c) => c.path === "/api/platform/console")).toHaveLength(0);
  });

  it("after resetConsoleSwitch (the user's «Riprova») the next 409 posts once and reloads once, then a new document reports instead of looping", async () => {
    const { calls, env, store, location } = setup({
      "/api/platform/me": [nine, nine, nine, nine],
      "/api/platform/tenants": [nine],
      "/api/platform/console": [ok({ mode: "console" })],
    });
    store.set(SWITCH_KEY, "1");
    await consoleApi("/api/platform/me", {}, env); // reported
    resetConsoleSwitch(env);
    const [a, b] = await Promise.all([
      consoleApi("/api/platform/me", {}, env),
      consoleApi("/api/platform/tenants", {}, env),
    ]);
    expect(calls.filter((c) => c.path === "/api/platform/console")).toHaveLength(1);
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(failure(a).leaving).toBe(true);
    expect(failure(b).leaving).toBe(true);
    // the reload gives a new document (a new location object) with the key still set: it reports, it does not POST
    const next = { ...env, location: { ...location, reload: vi.fn() } };
    const again = failure(await consoleApi("/api/platform/me", {}, next));
    expect(again.error.code).toBe("console_unavailable");
    expect(calls.filter((c) => c.path === "/api/platform/console")).toHaveLength(1);
  });

  it("a new document after the report can switch again", async () => {
    const { calls, env, store } = setup({
      "/api/platform/me": [nine, nine],
      "/api/platform/console": [ok({ mode: "console" })],
    });
    store.set(SWITCH_KEY, "1");
    await consoleApi("/api/platform/me", {}, env); // reported, key cleared
    const fresh = { ...env, location: { ...env.location, reload: vi.fn() } };
    const result = failure(await consoleApi("/api/platform/me", {}, fresh));
    expect(result.leaving).toBe(true);
    expect(calls.filter((c) => c.path === "/api/platform/console")).toHaveLength(1);
  });
});
