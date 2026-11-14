import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/lib/api/client";
import { switchTenant, tabId, TENANT_SWITCH_CHANNEL, type SwitchDeps } from "@/lib/tenancy/switch";

// SP2 S8 (docs/plans/2026-11-14-sp2-memberships.md §3.5): the one way to change venue. The server is mocked: every dependency is injected.
const TENANT = "22222222-2222-4222-8222-222222222222";

const fail = (status: number, code: string): ApiResult<unknown> => ({
  ok: false,
  status,
  error: { code, message: "x" },
});
const ok: ApiResult<unknown> = { ok: true, status: 200, data: { tenantId: TENANT } };

/** Dependencies that record the order of every call. */
function setup(result: ApiResult<unknown>, online = true) {
  const order: string[] = [];
  const deps = {
    isOnline: vi.fn(() => online),
    forget: vi.fn(() => void order.push("forget")),
    post: vi.fn(async (tenantId: string) => {
      order.push(`post:${tenantId}`);
      return result;
    }),
    announce: vi.fn(() => void order.push("announce")),
    load: vi.fn((path: string) => void order.push(`load:${path}`)),
  } satisfies SwitchDeps;
  return { deps, order };
}

describe("switchTenant", () => {
  it("forgetUser runs before the POST and again after a 200, then a full load of the safe next path", async () => {
    const { deps, order } = setup(ok);
    const result = await switchTenant(TENANT, { next: "/tavoli?sala=2" }, deps);
    expect(result).toEqual({ ok: true });
    expect(order).toEqual([
      "forget",
      `post:${TENANT}`,
      "forget",
      "announce",
      "load:/tavoli?sala=2",
    ]);
  });

  it("loads / when next is missing", async () => {
    const { deps } = setup(ok);
    await switchTenant(TENANT, { next: undefined }, deps);
    expect(deps.load).toHaveBeenCalledExactlyOnceWith("/");
  });

  it.each(["//evil.test", "https://evil.test/x", "/\\evil.test", "tavoli"])(
    "an unsafe next (%s) loads /",
    async (next) => {
      const { deps } = setup(ok);
      await switchTenant(TENANT, { next }, deps);
      expect(deps.load).toHaveBeenCalledExactlyOnceWith("/");
    },
  );

  it("offline: nothing is called and the code is offline", async () => {
    const { deps } = setup(ok, false);
    const result = await switchTenant(TENANT, { next: "/" }, deps);
    expect(result).toEqual({ ok: false, code: "offline" });
    expect(deps.forget).not.toHaveBeenCalled();
    expect(deps.post).not.toHaveBeenCalled();
    expect(deps.announce).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid_request", "invalid_request"],
    [403, "forbidden", "forbidden"],
    [404, "tenant_not_found", "tenant_not_found"],
    [429, "tenant_switch_too_soon", "tenant_switch_too_soon"],
  ])(
    "%i: nothing changed on the server, so one forgetUser, no other tabs told, no navigation, the code %s returned",
    async (status, serverCode, code) => {
      const { deps } = setup(fail(status, serverCode));
      const result = await switchTenant(TENANT, { next: "/" }, deps);
      expect(result).toEqual({ ok: false, code });
      expect(deps.forget).toHaveBeenCalledTimes(1);
      expect(deps.announce).not.toHaveBeenCalled();
      expect(deps.load).not.toHaveBeenCalled();
    },
  );

  it.each([
    [403, "invalid_origin"],
    [400, "invalid_json"],
    [404, "bad_response"],
    [403, "mfa_required"],
    [429, "rate_limited"],
  ])(
    "%i with the server's own code %s returns that code, not a name chosen by the status alone",
    async (status, serverCode) => {
      const { deps } = setup(fail(status, serverCode));
      const result = await switchTenant(TENANT, { next: "/" }, deps);
      expect(result).toEqual({ ok: false, code: serverCode });
      expect(deps.forget).toHaveBeenCalledTimes(1);
      expect(deps.announce).not.toHaveBeenCalled();
      expect(deps.load).not.toHaveBeenCalled();
    },
  );

  it("a signed-out answer (401) returns its code and changes nothing (the client already handled the sign-in redirect)", async () => {
    const { deps } = setup(fail(401, "unauthenticated"));
    const result = await switchTenant(TENANT, { next: "/" }, deps);
    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(deps.forget).toHaveBeenCalledTimes(1);
    expect(deps.load).not.toHaveBeenCalled();
  });

  it.each([
    ["a network error", fail(0, "network")],
    ["a 503", fail(503, "tenant_switch_failed")],
    ["a 500", fail(500, "internal_error")],
  ])(
    "%s: the server may have switched, so a second forgetUser, other tabs told and a full load of /, even with a next",
    async (_label, result) => {
      const { deps, order } = setup(result);
      const outcome = await switchTenant(TENANT, { next: "/tavoli" }, deps);
      expect(outcome).toEqual({ ok: false, code: "tenant_switch_failed" });
      expect(order).toEqual(["forget", `post:${TENANT}`, "forget", "announce", "load:/"]);
    },
  );

  it("a success whose body is not JSON may have switched too: second forgetUser and a load of /", async () => {
    const { deps, order } = setup(fail(200, "bad_response"));
    const outcome = await switchTenant(TENANT, { next: "/tavoli" }, deps);
    expect(outcome).toEqual({ ok: false, code: "tenant_switch_failed" });
    expect(order.at(-1)).toBe("load:/");
  });

  it("an answer the client has no rule for returns the server's own code and changes nothing", async () => {
    const { deps } = setup(fail(418, "teapot"));
    const result = await switchTenant(TENANT, { next: "/" }, deps);
    expect(result).toEqual({ ok: false, code: "teapot" });
    expect(deps.forget).toHaveBeenCalledTimes(1);
    expect(deps.load).not.toHaveBeenCalled();
  });

  it("never clears the outbox: the module reaches no outbox code, so held operations survive", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/tenancy/switch.ts"), "utf8");
    expect(source).not.toMatch(/pwa\/outbox|use-outbox|clearOutbox|outbox\.clear/);
    // And it only forgets the user through forgetUser, which keeps the outbox (src/components/forget-user.ts).
    expect(source).toMatch(/from "@\/components\/forget-user"/);
  });
});

describe("switchTenant with the browser's own dependencies", () => {
  afterEach(() => vi.unstubAllGlobals());

  function browser(options: { online?: boolean; broadcast?: boolean } = {}) {
    const assign = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ tenantId: TENANT }), { status: 200 }));
    const posted: unknown[] = [];
    const close = vi.fn();
    class FakeChannel {
      constructor(public name: string) {
        posted.push({ opened: name });
      }
      postMessage(message: unknown) {
        posted.push(message);
      }
      close = close;
    }
    vi.stubGlobal("navigator", { onLine: options.online ?? true });
    vi.stubGlobal("window", { location: { pathname: "/", search: "", assign } });
    vi.stubGlobal("fetch", fetchMock);
    if (options.broadcast !== false) vi.stubGlobal("BroadcastChannel", FakeChannel);
    return { assign, fetchMock, posted, close };
  }

  it("posts the tenant to /api/me/tenant, tells the other tabs with this tab's id, and loads the next path", async () => {
    const { assign, fetchMock, posted, close } = browser();
    const result = await switchTenant(TENANT, { next: "/tavoli" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/tenant",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ tenantId: TENANT }) }),
    );
    // (forgetUser's own queue-user clear opens its own channel; only ours is asserted.)
    expect(posted).toContainEqual({ opened: TENANT_SWITCH_CHANNEL });
    expect(posted).toContainEqual({ type: "switched", from: tabId() });
    expect(close).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledExactlyOnceWith("/tavoli");
  });

  it("a browser without BroadcastChannel still switches and loads (the residual risk R5)", async () => {
    const { assign } = browser({ broadcast: false });
    expect(await switchTenant(TENANT, { next: "/" })).toEqual({ ok: true });
    expect(assign).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("navigator.onLine false: offline, no request", async () => {
    const { fetchMock, assign } = browser({ online: false });
    expect(await switchTenant(TENANT, { next: "/" })).toEqual({ ok: false, code: "offline" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("the tab id is made once and is a uuid", () => {
    expect(tabId()).toBe(tabId());
    expect(tabId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  // Staging and production are HTTPS only, so there is no fallback (Rule B, lead): without crypto.randomUUID (a plain-http page) it fails loudly.
  it("without crypto.randomUUID the tab id throws a clear error, never a made-up id", async () => {
    vi.resetModules();
    vi.stubGlobal("crypto", {});
    try {
      const fresh = await import("@/lib/tenancy/switch");
      expect(() => fresh.tabId()).toThrow(
        "tabId: crypto.randomUUID is missing; the app needs a secure context (HTTPS)",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
