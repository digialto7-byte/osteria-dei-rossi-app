import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dataRpcCalls,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// SP3 step 17 (docs/plans/2026-11-15-sp3-console.md §3.4.1): withApi's platform access. A console route needs a console-mode token (role platform_staff) at aal2;
// any other token is 409 console_selection_required (the client switches and reloads), an aal1 console token is 403 mfa_required. A console token on any venue
// or login route is 403 console_session before any RPC, except on a route that says `consoleSession: "allow"` (logout, the switch itself).
let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const { withApi } = await import("@/lib/api/with-api");
const STAFF = "a7000000-0000-4000-8000-000000000001";
const SESSION = "c7000000-0000-4000-8000-000000000001";
const CONSOLE = { sub: STAFF, role: "platform_staff", session_id: SESSION, aal: "aal2" };
const AUTHENTICATED = { sub: STAFF, role: "authenticated", session_id: SESSION, aal: "aal2" };

const seen: unknown[] = [];
const platformRoute = withApi({ platform: true }, async ({ session }) => {
  seen.push(session);
  return Response.json({ ok: true });
});
const tenantRoute = withApi({ roles: ["owner", "admin", "chef", "waiter"] }, async () =>
  Response.json({ ok: true }),
);
const loginRoute = withApi({ authenticated: true }, async () => Response.json({ ok: true }));
const consoleAllowedRoute = withApi(
  { authenticated: true, consoleSession: "allow" },
  async ({ session }) => {
    seen.push(session);
    return Response.json({ ok: true });
  },
);
const get = (route: (r: Request) => Promise<Response>) =>
  route(new Request("http://127.0.0.1:3000/api/platform/test"));
const codeOf = async (response: Response) => (await response.json()).error.code as string;

beforeEach(() => {
  reportError.mockReset();
  seen.length = 0;
});

describe("withApi({ platform: true })", () => {
  it("a console-mode token at aal2 reaches the handler with its auth id, and withApi makes no RPC", async () => {
    client = fakeSupabase({ claims: CONSOLE });
    const response = await get(platformRoute);
    expect(response.status).toBe(200);
    expect(seen).toEqual([{ authId: STAFF }]);
    expect(dataRpcCalls(client, 0)).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("an authenticated token (not in console mode) is 409 console_selection_required, before any RPC", async () => {
    client = fakeSupabase({ claims: AUTHENTICATED });
    const response = await get(platformRoute);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("console_selection_required");
    expect(seen).toEqual([]);
    expect(dataRpcCalls(client, 0)).toEqual([]);
  });

  it("so is a token with no role claim and a venue owner's token", async () => {
    client = fakeSupabase({ claims: { sub: STAFF, session_id: SESSION } });
    expect(await codeOf(await get(platformRoute))).toBe("console_selection_required");
    client = fakeSupabase({ claims: { ...OWNER_CLAIMS, role: "authenticated" } });
    expect(await codeOf(await get(platformRoute))).toBe("console_selection_required");
  });

  it("a console-mode token at aal1, or without an aal claim, is 403 mfa_required", async () => {
    client = fakeSupabase({ claims: { ...CONSOLE, aal: "aal1" } });
    let response = await get(platformRoute);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("mfa_required");
    client = fakeSupabase({ claims: { ...CONSOLE, aal: undefined } });
    response = await get(platformRoute);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("mfa_required");
    expect(seen).toEqual([]);
  });

  it("signed out is 401 unauthenticated", async () => {
    client = fakeSupabase({ claims: null });
    const response = await get(platformRoute);
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthenticated");
  });

  it("a console session older than 30 days is 401 session_expired (ADR-029 holds for the console too)", async () => {
    const old = Math.floor(Date.now() / 1000) - 31 * 86_400;
    client = fakeSupabase({
      claims: { ...CONSOLE, amr: [{ method: "password", timestamp: old }] },
    });
    const response = await get(platformRoute);
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("session_expired");
  });
});

describe("a console-mode token outside the console", () => {
  it("on a venue route is 403 console_session before any RPC", async () => {
    client = fakeSupabase({ claims: { ...CONSOLE } });
    const response = await get(tenantRoute);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("console_session");
    expect(dataRpcCalls(client, 0)).toEqual([]);
  });

  it("even with a tenant claim (never given by the hook) it is 403 console_session, not the venue", async () => {
    client = fakeSupabase({ claims: { ...OWNER_CLAIMS, role: "platform_staff" } });
    const response = await get(tenantRoute);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("console_session");
    expect(dataRpcCalls(client, 0)).toEqual([]);
  });

  it("on a login route (authenticated) is 403 console_session", async () => {
    client = fakeSupabase({ claims: CONSOLE });
    const response = await get(loginRoute);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("console_session");
    expect(dataRpcCalls(client, 0)).toEqual([]);
  });

  it("a route that allows the console session (logout, the switch) gets it as a login session", async () => {
    client = fakeSupabase({ claims: CONSOLE });
    const response = await get(consoleAllowedRoute);
    expect(response.status).toBe(200);
    expect(seen).toEqual([{ authId: STAFF, tenantId: null, pinLogin: false, consoleMode: true }]);
  });

  it("and an authenticated token there is a login session with consoleMode false", async () => {
    client = fakeSupabase({ claims: AUTHENTICATED });
    await get(consoleAllowedRoute);
    expect(seen).toEqual([{ authId: STAFF, tenantId: null, pinLogin: false, consoleMode: false }]);
  });

  it("venue and login routes are unchanged for every other token", async () => {
    client = fakeSupabase({ claims: { ...OWNER_CLAIMS, role: "authenticated" } });
    expect((await get(tenantRoute)).status).toBe(200);
    client = fakeSupabase({ claims: OWNER_CLAIMS });
    expect((await get(tenantRoute)).status).toBe(200);
    expect((await get(loginRoute)).status).toBe(200);
  });

  it("a public route never reads the token, so it is unaffected", async () => {
    const publicRoute = withApi({ public: true }, async () => Response.json({ ok: true }));
    client = fakeSupabase({ claims: CONSOLE });
    expect((await get(publicRoute)).status).toBe(200);
    expect(client.auth.getClaims).not.toHaveBeenCalled();
  });
});

// Review of PR 4: the console-session exception stays on exactly two routes (logout and the switch). Any other route that says "allow" fails here.
describe("consoleSession allow is used by exactly two routes", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join, relative } = await import("node:path");
  it("/api/platform/console and /api/platform/logout, nothing else under src/app/api", () => {
    const root = join(process.cwd(), "src/app/api");
    const users = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name === "route.ts")
      .map((e) => join(e.parentPath, e.name))
      .filter((file) => /consoleSession/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file))
      .sort();
    expect(users).toEqual(["platform/console/route.ts", "platform/logout/route.ts"]);
  });
});
