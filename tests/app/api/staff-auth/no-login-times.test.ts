import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { PEPPER, postJson } from "./helpers";

// Q10 (ADR-010 condition 5): the owner sees no per-person login or logout times. The routes under
// /api/users* and /api/devices* build their answers field by field, so a login timestamp that the
// database layer returned by mistake is dropped; this test feeds them such fields and scans the answers.
process.env.PIN_PEPPER = PEPPER;
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("@/server/staff-auth/privileged", () => ({
  createStaffAuthUser: vi.fn(async () => ({ authId: "22222222-2222-4222-8222-222222222222" })),
  setStaffAuthPassword: vi.fn(),
  deleteOrphanStaffAuthUser: vi.fn(),
}));

const users = await import("@/app/api/users/route");
const user = await import("@/app/api/users/[id]/route");
const devices = await import("@/app/api/devices/route");
const device = await import("@/app/api/devices/[id]/route");
const unlock = await import("@/app/api/devices/[id]/unlock/route");

const ID = "11111111-1111-4111-8111-111111111111";
const ctx = routeContext({ id: ID });
const T = "2026-10-24T17:02:00Z";
// Every login-ish field the database layer could hand back by mistake.
const ROGUE = {
  last_login_at: T,
  lastLoginAt: T,
  logged_in_at: T,
  login_at: T,
  logout_at: T,
  last_seen: T,
  session_started_at: T,
  started_at: T,
  ended_at: T,
  finished_at: T,
  sessions: [{ started_at: T }],
  attempts: [{ outcome: "success" }],
};
const USER_ROW = {
  id: ID,
  display_name: "Cameriere Demo",
  role: "waiter",
  login_method: "pin",
  is_active: true,
  locked_until: null,
  ...ROGUE,
};
const DEVICE = {
  id: ID,
  label: "Telefono sala (demo)",
  status: "attivo",
  enrolledAt: T,
  lockedAt: null,
  ...ROGUE,
  lastLoginBy: "Cameriere Demo",
  userId: ID,
};

// loginMethod (email or pin) names how a person signs in, not when.
const LOGIN_KEY =
  /log(in|out|ged)(?!method)|session|started|ended|finished|attempt|last_?seen|seen|by$|userId|user_id/i;
// Timestamps that may appear: when a lock ends, when something was set up or expires, and a DEVICE's own
// last use (never tied to a person).
const ALLOWED_TIME_KEYS = new Set([
  "lockedUntil",
  "enrolledAt",
  "expiresAt",
  "lockedAt",
  "lastLoginAt",
]);

type Found = { path: string; key: string; value: unknown };
function walk(value: unknown, path: string, out: Found[]) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [key, inner] of Object.entries(value)) {
      out.push({ path: `${path}.${key}`, key, value: inner });
      walk(inner, `${path}.${key}`, out);
    }
}

async function answers(): Promise<{ route: string; body: unknown }[]> {
  const run = async (route: string, role: string, rpc: never, call: () => Promise<Response>) => {
    client = fakeSupabase({ claims: claimsFor(role), rpc });
    return { route, body: await (await call()).json() };
  };
  const ok = (data: unknown) => [{ data, error: null }];
  return [
    await run("GET /api/users", "owner", { staff_list: ok([USER_ROW]) } as never, () =>
      users.GET(new Request("http://localhost:3000/api/users")),
    ),
    await run(
      "POST /api/users",
      "owner",
      {
        assert_staff_manager: ok(null),
        create_staff: ok({ ...USER_ROW, displayName: "x" }),
      } as never,
      () => users.POST(postJson("/api/users", { displayName: "x", role: "waiter", pin: "4827" })),
    ),
    await run(
      "PATCH /api/users/:id",
      "owner",
      { update_staff: ok({ ...USER_ROW, displayName: "x", active: true }) } as never,
      () =>
        user.PATCH(
          new Request(`http://localhost:3000/api/users/${ID}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ active: true }),
          }),
          ctx,
        ),
    ),
    await run(
      "GET /api/devices",
      "admin",
      {
        device_overview: ok({
          devices: [DEVICE],
          pendingCodes: [{ id: ID, label: "x", expiresAt: T, ...ROGUE }],
        }),
      } as never,
      () => devices.GET(new Request("http://localhost:3000/api/devices")),
    ),
    await run("DELETE /api/devices/:id", "owner", { revoke_device: ok(DEVICE) } as never, () =>
      device.DELETE(
        new Request(`http://localhost:3000/api/devices/${ID}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        ctx,
      ),
    ),
    await run("POST /api/devices/:id/unlock", "owner", { unlock_device: ok(DEVICE) } as never, () =>
      unlock.POST(postJson(`/api/devices/${ID}/unlock`, {}), ctx),
    ),
  ];
}

beforeEach(() => undefined);

describe("Q10: no per-person login or logout times in owner responses", () => {
  it("no key names a login, logout, session, attempt or person-on-device, except a device's own lastLoginAt", async () => {
    for (const { route, body } of await answers()) {
      const found: Found[] = [];
      walk(body, route, found);
      const bad = found.filter(
        ({ key }) => LOGIN_KEY.test(key) && !(key === "lastLoginAt" && route.includes("devices")),
      );
      expect(bad, route).toEqual([]);
    }
  });

  it("lastLoginAt never appears under /api/users*", async () => {
    for (const { route, body } of (await answers()).filter((a) => a.route.includes("/api/users"))) {
      expect(JSON.stringify(body), route).not.toMatch(/lastLogin|loginAt|logoutAt|logged/i);
    }
  });

  it("a timestamp value appears only under an allowed key", async () => {
    for (const { route, body } of await answers()) {
      const found: Found[] = [];
      walk(body, route, found);
      const stray = found.filter(
        ({ key, value }) =>
          typeof value === "string" && value.startsWith("2026-") && !ALLOWED_TIME_KEYS.has(key),
      );
      expect(stray, route).toEqual([]);
    }
  });

  it("the user routes carry no timestamp but lockedUntil", async () => {
    for (const { route, body } of (await answers()).filter((a) => a.route.includes("/api/users"))) {
      const found: Found[] = [];
      walk(body, route, found);
      const times = found.filter(
        ({ value }) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value),
      );
      expect(
        times.filter(({ key }) => key !== "lockedUntil"),
        route,
      ).toEqual([]);
    }
  });
});
