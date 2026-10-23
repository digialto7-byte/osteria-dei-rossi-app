import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { derivePinPassword } from "@/server/staff-auth/derive";
import { StaffAuthCallError } from "@/server/staff-auth/errors";
import { PEPPER, postJson } from "./helpers";

// M11 acceptance test 6 (API half) and the role table of the owner routes.
process.env.PIN_PEPPER = PEPPER;
let client: FakeSupabase;
const privileged = vi.hoisted(() => ({
  beginPinLogin: vi.fn(),
  finishPinLogin: vi.fn(),
  redeemEnrolmentCode: vi.fn(),
  deviceStaffList: vi.fn(),
  createStaffAuthUser: vi.fn(),
  setStaffAuthPassword: vi.fn(),
  deleteOrphanStaffAuthUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("@/server/staff-auth/privileged", () => privileged);

const users = await import("@/app/api/users/route");
const user = await import("@/app/api/users/[id]/route");
const pinRoute = await import("@/app/api/users/[id]/pin/route");

const ID = "11111111-1111-4111-8111-111111111111";
const AUTH = "22222222-2222-4222-8222-222222222222";
const ctx = routeContext({ id: ID });
const ok = (data: unknown = null) => [{ data, error: null }];
const fail = (code: string, message = "x") => [{ data: null, error: { code, message } }];
type Script = Record<string, { data: unknown; error: { code?: string; message: string } | null }[]>;
const make = (role: string | null, script: Script = {}) => {
  client = fakeSupabase({ claims: role ? claimsFor(role) : null, rpc: script });
};
const callNames = () => client.rpc.mock.calls.map((c) => c[0]);
const allPrivilegedCalls = () => Object.values(privileged).flatMap((m) => m.mock.calls);
const patch = (body: unknown) =>
  new Request(`http://localhost:3000/api/users/${ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const CREATED = { id: ID, displayName: "Cameriere Demo", role: "waiter", active: true };

beforeEach(() => {
  for (const mock of Object.values(privileged)) mock.mockReset();
  privileged.createStaffAuthUser.mockResolvedValue({ authId: AUTH });
  privileged.setStaffAuthPassword.mockResolvedValue(undefined);
  privileged.deleteOrphanStaffAuthUser.mockResolvedValue(true);
});

const ROUTES: [string, () => Promise<Response>][] = [
  ["GET users", () => users.GET(new Request("http://localhost:3000/api/users"))],
  [
    "POST users",
    () =>
      users.POST(
        postJson("/api/users", { displayName: "Cameriere Demo", role: "waiter", pin: "4827" }),
      ),
  ],
  ["PATCH users/:id", () => user.PATCH(patch({ active: false }), ctx)],
  [
    "POST users/:id/pin",
    () => pinRoute.POST(postJson(`/api/users/${ID}/pin`, { pin: "4827" }), ctx),
  ],
];
const FULL: Script = {
  staff_list: ok([]),
  assert_staff_manager: ok(),
  create_staff: ok(CREATED),
  update_staff: ok(CREATED),
  prepare_pin_change: ok({ authId: AUTH }),
  record_pin_change: ok(),
};

describe("user routes: roles", () => {
  it.each(ROUTES)(
    "%s: chef and waiter get 403 before any RPC or privileged call",
    async (_n, call) => {
      for (const role of ["chef", "waiter"]) {
        make(role, FULL);
        expect((await call()).status).toBe(403);
        expect(client.rpc).not.toHaveBeenCalled();
        expect(allPrivilegedCalls()).toEqual([]);
      }
    },
  );
  it.each(ROUTES)("%s: no session gets 401", async (_n, call) => {
    make(null, FULL);
    expect((await call()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("%s: owner and admin get 2xx", async (_n, call) => {
    for (const role of ["owner", "admin"]) {
      make(role, FULL);
      expect((await call()).status).toBeLessThan(300);
    }
  });
});

describe("POST /api/users", () => {
  const body = { displayName: "Cameriere Demo", role: "waiter", pin: "4827" };

  it.each(["1234", "0000", "9999", "6789", "3210", "1212", "9090"])(
    "PIN %s -> 422 pin_trivial and no RPC and no privileged call",
    async (pin) => {
      make("owner", FULL);
      const response = await users.POST(postJson("/api/users", { ...body, pin }));
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("pin_trivial");
      expect(client.rpc).not.toHaveBeenCalled();
      expect(allPrivilegedCalls()).toEqual([]);
    },
  );

  it("checks the role, creates the Auth user with the derived password, then create_staff", async () => {
    make("owner", FULL);
    const response = await users.POST(postJson("/api/users", body));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ user: CREATED });
    const [newId, password] = privileged.createStaffAuthUser.mock.calls[0] as [string, string];
    expect(password).toBe(derivePinPassword(PEPPER, newId, "4827"));
    expect(client.rpc.mock.calls[0]).toEqual(["assert_staff_manager"]);
    expect(client.rpc.mock.calls[1]).toEqual([
      "create_staff",
      { p_id: newId, p_auth_id: AUTH, p_display_name: "Cameriere Demo", p_role: "waiter" },
    ]);
    expect(client.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      privileged.createStaffAuthUser.mock.invocationCallOrder[0] ?? 0,
    );
    expect(privileged.createStaffAuthUser.mock.invocationCallOrder[0]).toBeLessThan(
      client.rpc.mock.invocationCallOrder[1] ?? 0,
    );
    expect(privileged.deleteOrphanStaffAuthUser).not.toHaveBeenCalled();
  });

  it("create_staff failing deletes the orphan Auth user and maps the error", async () => {
    make("owner", { ...FULL, create_staff: fail("P0001", "display_name_invalid") });
    const response = await users.POST(postJson("/api/users", body));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("display_name_invalid");
    expect(privileged.deleteOrphanStaffAuthUser).toHaveBeenCalledWith(AUTH);
  });

  it("a failing orphan clean-up does not hide the original error", async () => {
    make("owner", { ...FULL, create_staff: fail("P0001", "display_name_invalid") });
    privileged.deleteOrphanStaffAuthUser.mockRejectedValue(new StaffAuthCallError("x", "y"));
    expect((await users.POST(postJson("/api/users", body))).status).toBe(422);
  });

  it("assert_staff_manager 42501 -> 403 and no privileged call", async () => {
    make("owner", { ...FULL, assert_staff_manager: fail("42501") });
    expect((await users.POST(postJson("/api/users", body))).status).toBe(403);
    expect(allPrivilegedCalls()).toEqual([]);
  });

  it("the Auth admin call failing -> 502 and no create_staff", async () => {
    make("owner", FULL);
    privileged.createStaffAuthUser.mockRejectedValue(
      new StaffAuthCallError("c", "email_exists", 422),
    );
    const response = await users.POST(postJson("/api/users", body));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("upstream_error");
    expect(callNames()).toEqual(["assert_staff_manager"]);
  });

  it.each([
    { displayName: "", role: "waiter", pin: "4827" },
    { displayName: "x", role: "owner", pin: "4827" },
    { displayName: "x", role: "chef", pin: "48271" },
    { displayName: "x", role: "chef", pin: "4827", admin: true },
  ])("bad body %j -> 400, nothing called", async (bad) => {
    make("owner", FULL);
    const response = await users.POST(postJson("/api/users", bad));
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("48271");
  });
});

describe("PATCH /api/users/:id", () => {
  it("{} -> 400", async () => {
    make("owner", FULL);
    expect((await user.PATCH(patch({}), ctx)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("{active:false} -> update_staff with p_active false only", async () => {
    make("owner", FULL);
    const response = await user.PATCH(patch({ active: false }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: CREATED });
    expect(client.rpc).toHaveBeenCalledWith("update_staff", {
      p_user: ID,
      p_display_name: null,
      p_role: null,
      p_active: false,
    });
  });
  it("name and role are passed through", async () => {
    make("admin", FULL);
    await user.PATCH(patch({ displayName: " Nuovo ", role: "chef" }), ctx);
    expect(client.rpc).toHaveBeenCalledWith("update_staff", {
      p_user: ID,
      p_display_name: "Nuovo",
      p_role: "chef",
      p_active: null,
    });
  });
  it("another owner or admin -> 404; nothing_to_change -> 422", async () => {
    make("owner", { update_staff: fail("P0002", "staff_not_found") });
    expect((await user.PATCH(patch({ active: false }), ctx)).status).toBe(404);
    make("owner", { update_staff: fail("P0001", "nothing_to_change") });
    expect((await user.PATCH(patch({ active: false }), ctx)).status).toBe(422);
  });
});

describe("POST /api/users/:id/pin", () => {
  const call = (pin = "7046") => pinRoute.POST(postJson(`/api/users/${ID}/pin`, { pin }), ctx);

  it("prepare -> set password -> record, in that order, 204", async () => {
    make("owner", FULL);
    const response = await call();
    expect(response.status).toBe(204);
    expect(callNames()).toEqual(["prepare_pin_change", "record_pin_change"]);
    expect(privileged.setStaffAuthPassword).toHaveBeenCalledWith(
      AUTH,
      derivePinPassword(PEPPER, ID, "7046"),
    );
    expect(client.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      privileged.setStaffAuthPassword.mock.invocationCallOrder[0] ?? 0,
    );
    expect(privileged.setStaffAuthPassword.mock.invocationCallOrder[0]).toBeLessThan(
      client.rpc.mock.invocationCallOrder[1] ?? 0,
    );
    expect(client.rpc).toHaveBeenCalledWith("prepare_pin_change", { p_user: ID });
    expect(client.rpc).toHaveBeenCalledWith("record_pin_change", { p_user: ID });
  });

  it("a trivial PIN -> 422 and nothing is called", async () => {
    make("owner", FULL);
    expect((await call("1234")).status).toBe(422);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(allPrivilegedCalls()).toEqual([]);
  });

  it.each([
    ["staff_inactive", 409],
    ["staff_not_pin", 409],
  ])("%s -> %i and no privileged call", async (message, status) => {
    make("owner", { ...FULL, prepare_pin_change: fail("P0001", message) });
    const response = await call();
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(message);
    expect(allPrivilegedCalls()).toEqual([]);
  });

  it("an unknown user -> 404", async () => {
    make("owner", { ...FULL, prepare_pin_change: fail("P0002", "staff_not_found") });
    expect((await call()).status).toBe(404);
  });

  it("the admin call failing -> 502 and no record_pin_change", async () => {
    make("owner", FULL);
    privileged.setStaffAuthPassword.mockRejectedValue(
      new StaffAuthCallError("s", "unexpected_failure", 500),
    );
    const response = await call();
    expect(response.status).toBe(502);
    expect(callNames()).toEqual(["prepare_pin_change"]);
  });

  it("a malformed id -> 404 without any call", async () => {
    make("owner", FULL);
    const response = await pinRoute.POST(
      postJson("/api/users/x/pin", { pin: "7046" }),
      routeContext({ id: "x" }),
    );
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("responses never carry a PIN, password or hash key (AT5)", () => {
  const BAD_KEY = /pin|passw|hash|secret|pepper|token/i;
  const keys = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keys)
      : value && typeof value === "object"
        ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)])
        : [];

  it("scans every success and error body", async () => {
    const bodies: unknown[] = [];
    make("owner", {
      ...FULL,
      staff_list: ok([
        {
          id: ID,
          display_name: "A",
          role: "chef",
          login_method: "pin",
          is_active: true,
          locked_until: null,
        },
      ]),
    });
    for (const route of ROUTES) {
      const response = await route[1]();
      if (response.status !== 204) bodies.push(await response.json());
    }
    make("owner", FULL);
    bodies.push(
      await (
        await users.POST(postJson("/api/users", { displayName: "x", role: "chef", pin: "1234" }))
      ).json(),
    );
    const found = bodies.flatMap(keys).filter((k) => BAD_KEY.test(k));
    expect(found).toEqual([]);
    expect(JSON.stringify(bodies)).not.toContain("4827");
    expect(JSON.stringify(bodies)).not.toContain(derivePinPassword(PEPPER, ID, "4827"));
  });
});
