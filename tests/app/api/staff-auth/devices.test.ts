import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { sha256Hex } from "@/server/staff-auth/tokens";
import { PEPPER, postJson } from "./helpers";

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

const codes = await import("@/app/api/devices/enrolment-codes/route");
const list = await import("@/app/api/devices/route");
const one = await import("@/app/api/devices/[id]/route");
const unlock = await import("@/app/api/devices/[id]/unlock/route");

const ID = "55555555-5555-4555-8555-555555555555";
const ctx = routeContext({ id: ID });
const EXPIRES = "2026-10-24T19:17:00Z";
const DEVICE = {
  id: ID,
  label: "Telefono sala (demo)",
  status: "attivo",
  enrolledAt: "2026-10-24T10:00:00Z",
  lastLoginAt: null,
  lockedAt: null,
};
const rpc = (map: Record<string, { data: unknown; error?: unknown }[]>) =>
  Object.fromEntries(
    Object.entries(map).map(([k, v]) => [
      k,
      v.map((r) => ({ data: r.data, error: r.error ?? null })),
    ]),
  ) as never;
const make = (role: string | null, rpcMap = {}) => {
  client = fakeSupabase({ claims: role ? claimsFor(role) : null, rpc: rpc(rpcMap) });
};
const req = (method: string, path: string, body?: unknown) =>
  body === undefined
    ? new Request(`http://localhost:3000${path}`, {
        method,
        headers: method === "GET" ? {} : { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      })
    : postJson(path, body);

beforeEach(() => {
  for (const mock of Object.values(privileged)) mock.mockReset();
});

const ROUTES: [string, () => Promise<Response>][] = [
  [
    "POST enrolment-codes",
    () => codes.POST(postJson("/api/devices/enrolment-codes", { label: "Telefono sala (demo)" })),
  ],
  ["GET devices", () => list.GET(req("GET", "/api/devices"))],
  ["DELETE devices/:id", () => one.DELETE(req("DELETE", `/api/devices/${ID}`), ctx)],
  ["POST devices/:id/unlock", () => unlock.POST(postJson(`/api/devices/${ID}/unlock`, {}), ctx)],
];

describe("device routes: roles", () => {
  it.each(ROUTES)("%s: chef and waiter get 403 before any RPC", async (_n, call) => {
    for (const role of ["chef", "waiter"]) {
      make(role);
      expect((await call()).status).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });
  it.each(ROUTES)("%s: no session gets 401", async (_n, call) => {
    make(null);
    expect((await call()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("%s: owner and admin pass the gate", async (_n, call) => {
    for (const role of ["owner", "admin"]) {
      make(role, {
        create_enrolment_code: [{ data: { id: ID, label: "x", expiresAt: EXPIRES } }],
        device_overview: [{ data: { devices: [], pendingCodes: [] } }],
        revoke_device: [{ data: DEVICE }],
        unlock_device: [{ data: DEVICE }],
      });
      expect((await call()).status).toBeLessThan(300);
    }
  });
  it.each(ROUTES)("%s: never calls the privileged module", async (_n, call) => {
    make("owner", {
      create_enrolment_code: [{ data: { id: ID, label: "x", expiresAt: EXPIRES } }],
      device_overview: [{ data: { devices: [], pendingCodes: [] } }],
      revoke_device: [{ data: DEVICE }],
      unlock_device: [{ data: DEVICE }],
    });
    await call();
    for (const mock of Object.values(privileged)) expect(mock).not.toHaveBeenCalled();
  });
});

describe("POST /api/devices/enrolment-codes", () => {
  it("sends only the hash of the code, returns the code once, no-store", async () => {
    make("owner", {
      create_enrolment_code: [
        { data: { id: ID, label: "Telefono sala (demo)", expiresAt: EXPIRES } },
      ],
    });
    const response = await codes.POST(
      postJson("/api/devices/enrolment-codes", { label: " Telefono sala (demo) " }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(body.display).toBe(`${body.code.slice(0, 4)}-${body.code.slice(4)}`);
    expect(body).toMatchObject({ label: "Telefono sala (demo)", expiresAt: EXPIRES });
    const [fn, args] = client.rpc.mock.calls[0] as [string, Record<string, string>];
    expect(fn).toBe("create_enrolment_code");
    expect(args).toEqual({ p_code_hash: sha256Hex(body.code), p_label: "Telefono sala (demo)" });
    expect(JSON.stringify(client.rpc.mock.calls)).not.toContain(body.code);
  });

  it("a hash collision (23505) is retried once with a new code", async () => {
    make("owner", {
      create_enrolment_code: [
        { data: null, error: { code: "23505", message: "dup" } },
        { data: { id: ID, label: "x", expiresAt: EXPIRES } },
      ],
    });
    const response = await codes.POST(postJson("/api/devices/enrolment-codes", { label: "x" }));
    expect(response.status).toBe(201);
    const calls = client.rpc.mock.calls as [string, { p_code_hash: string }][];
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1].p_code_hash).not.toBe(calls[1]?.[1].p_code_hash);
    expect(sha256Hex((await response.json()).code)).toBe(calls[1]?.[1].p_code_hash);
  });

  it("a second collision is a 500, not a loop", async () => {
    make("owner", {
      create_enrolment_code: [{ data: null, error: { code: "23505", message: "dup" } }],
    });
    const response = await codes.POST(postJson("/api/devices/enrolment-codes", { label: "x" }));
    expect(response.status).toBe(500);
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("label_invalid from the database -> 422; bad bodies -> 400", async () => {
    make("owner", {
      create_enrolment_code: [{ data: null, error: { code: "P0001", message: "label_invalid" } }],
    });
    const response = await codes.POST(postJson("/api/devices/enrolment-codes", { label: "x" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("label_invalid");
    for (const body of [{}, { label: "" }, { label: "x".repeat(61) }, { label: "x", extra: 1 }]) {
      make("owner");
      expect((await codes.POST(postJson("/api/devices/enrolment-codes", body))).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });
});

describe("device list, revoke, unlock", () => {
  it("GET lists devices and pending codes, picking fields explicitly", async () => {
    make("admin", {
      device_overview: [
        {
          data: {
            devices: [{ ...DEVICE, tokenHash: "x", createdBy: "y" }],
            pendingCodes: [{ id: ID, label: "Tablet", expiresAt: EXPIRES, code: "SECRET" }],
          },
        },
      ],
    });
    const response = await list.GET(req("GET", "/api/devices"));
    expect(await response.json()).toEqual({
      devices: [DEVICE],
      pendingCodes: [{ id: ID, label: "Tablet", expiresAt: EXPIRES }],
    });
  });

  it("DELETE revokes through revoke_device and repeats are fine", async () => {
    make("owner", { revoke_device: [{ data: { ...DEVICE, status: "revocato" } }] });
    const response = await one.DELETE(req("DELETE", `/api/devices/${ID}`), ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).device.status).toBe("revocato");
    expect(client.rpc).toHaveBeenCalledWith("revoke_device", { p_device: ID });
  });

  it("an unknown device is 404 and a malformed id is 404 without an RPC", async () => {
    make("owner", {
      revoke_device: [{ data: null, error: { code: "P0002", message: "device_not_found" } }],
    });
    expect((await one.DELETE(req("DELETE", `/api/devices/${ID}`), ctx)).status).toBe(404);
    make("owner");
    const bad = await one.DELETE(req("DELETE", "/api/devices/x"), routeContext({ id: "x" }));
    expect(bad.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("unlock calls unlock_device; a revoked device is 409 device_revoked", async () => {
    make("owner", { unlock_device: [{ data: DEVICE }] });
    const response = await unlock.POST(postJson(`/api/devices/${ID}/unlock`, {}), ctx);
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("unlock_device", { p_device: ID });
    make("owner", {
      unlock_device: [{ data: null, error: { code: "P0001", message: "device_revoked" } }],
    });
    const conflict = await unlock.POST(postJson(`/api/devices/${ID}/unlock`, {}), ctx);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("device_revoked");
  });

  it("unlock refuses a body with keys", async () => {
    make("owner");
    expect((await unlock.POST(postJson(`/api/devices/${ID}/unlock`, { x: 1 }), ctx)).status).toBe(
      400,
    );
  });
});
