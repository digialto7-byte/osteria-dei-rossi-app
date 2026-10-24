import { describe, expect, it } from "vitest";
import {
  PERF_ITEM_COUNT,
  PERF_TENANT_NAME,
  assertTarget,
  measure,
  nearestRank,
  parseServerTiming,
  provision,
  renderReport,
  run,
  summarize,
  type AdminPort,
  type PerfPorts,
  type Reply,
  type Role,
} from "../../scripts/lib/perf-order-entry";

// AT7's measurement script (M18 step 17) with every port faked: no network, no clock, no secret key. The script is run
// by hand by the founder on `main`, once, against staging; these tests pin its arithmetic, its target guard, its
// idempotent setup and what its report may say.

const REF = "abcdefghijklmnopqrst";
const SUPABASE = `https://${REF}.supabase.co`;
const APP = "https://staging-app.example.test";
const TENANT = "5e000000-0000-4000-8000-0000000000aa";

describe("nearestRank and summarize", () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it("p50 and p95 of 1..100 are 50 and 95 (nearest rank)", () => {
    expect(nearestRank(hundred, 50)).toBe(50);
    expect(nearestRank(hundred, 95)).toBe(95);
    expect(nearestRank(hundred, 100)).toBe(100);
  });

  it("sorts its input and does not change it", () => {
    const shuffled = [5, 1, 4, 2, 3];
    expect(nearestRank(shuffled, 50)).toBe(3);
    expect(shuffled).toEqual([5, 1, 4, 2, 3]);
  });

  it("works on one sample and says nothing about none", () => {
    expect(nearestRank([7], 95)).toBe(7);
    expect(nearestRank([], 50)).toBeNull();
  });

  it("summarize gives n, p50, p95 and max", () => {
    expect(summarize(hundred)).toEqual({ n: 100, p50: 50, p95: 95, max: 100 });
    expect(summarize([])).toEqual({ n: 0, p50: null, p95: null, max: null });
  });
});

describe("parseServerTiming", () => {
  it("reads the durations by name", () => {
    expect(parseServerTiming("auth;dur=12.5, rpc;dur=40")).toEqual({ auth: 12.5, rpc: 40 });
    expect(parseServerTiming("auth;dur=12.5, rpc;dur=40.0, total;dur=55.1")).toEqual({
      auth: 12.5,
      rpc: 40,
      total: 55.1,
    });
  });

  it("ignores an entry with no duration and any junk, and a missing header", () => {
    expect(parseServerTiming("cache;desc=hit, rpc;dur=3, ;dur=1, x;dur=abc")).toEqual({ rpc: 3 });
    expect(parseServerTiming(null)).toEqual({});
    expect(parseServerTiming("")).toEqual({});
  });

  it("reads a quoted description before the duration", () => {
    expect(parseServerTiming('db;desc="read, write";dur=9.5')).toEqual({ db: 9.5 });
  });
});

describe("assertTarget", () => {
  const ok = () => assertTarget({ supabaseUrl: SUPABASE, baseUrl: APP, stagingRef: REF });

  it("accepts the staging project and an https app URL, and returns the app origin", () => {
    expect(ok()).toEqual({ baseOrigin: APP });
    expect(
      assertTarget({
        supabaseUrl: `${SUPABASE}/`,
        baseUrl: `${APP}/some/path?x=1`,
        stagingRef: REF,
      }),
    ).toEqual({ baseOrigin: APP });
  });

  it.each([
    ["another project", `https://zzzzzzzzzzzzzzzzzzzz.supabase.co`],
    ["a look-alike host", `https://${REF}.supabase.co.evil.example`],
    ["a sub-domain trick", `https://x.${REF}.supabase.co`],
    ["a port", `https://${REF}.supabase.co:8443`],
    ["http", `http://${REF}.supabase.co`],
    ["the local stack", "http://127.0.0.1:54321"],
    ["not a URL", "nope"],
    ["nothing", ""],
  ])("refuses a Supabase URL that is %s", (_name, supabaseUrl) => {
    expect(() => assertTarget({ supabaseUrl, baseUrl: APP, stagingRef: REF })).toThrow(/Supabase/);
  });

  it.each([
    ["http", "http://staging-app.example.test"],
    ["no scheme", "staging-app.example.test"],
    ["credentials", "https://user:pw@staging-app.example.test"],
    ["not a URL", "::"],
    ["empty", ""],
  ])("refuses an app URL that is %s", (_name, baseUrl) => {
    expect(() => assertTarget({ supabaseUrl: SUPABASE, baseUrl, stagingRef: REF })).toThrow(
      /base_url/,
    );
  });

  it("refuses to run without a staging reference", () => {
    expect(() => assertTarget({ supabaseUrl: SUPABASE, baseUrl: APP, stagingRef: "" })).toThrow(
      /STAGING_PROJECT_REF/,
    );
    ok();
  });

  it("never prints the URL it refused", () => {
    try {
      assertTarget({
        supabaseUrl: "https://user:secret@evil.example",
        baseUrl: APP,
        stagingRef: REF,
      });
    } catch (error) {
      expect(String(error)).not.toContain("secret");
      expect(String(error)).not.toContain("evil.example");
    }
  });
});

// --- a fake world ------------------------------------------------------------------------------------------------

interface World {
  users: Map<string, string>; // email -> id
  passwords: Map<string, string>; // id -> current password
  tenantCreated: number;
  waiterAdded: number;
  items: { id: string; name: string; course: string }[];
  tables: { id: string; name: string }[];
  openCalls: number;
  requests: { role: Role; method: string; path: string; body: unknown }[];
  tenantOfOwner: boolean;
  waiterMember: boolean;
  sessionOpen: string | null;
  signIns: Role[];
}

function fakePorts(
  reply: (
    role: Role,
    method: string,
    path: string,
    body: unknown,
    world: World,
  ) => Reply | null = () => null,
  world: Partial<World> = {},
) {
  const w: World = {
    users: new Map(),
    passwords: new Map(),
    tenantCreated: 0,
    waiterAdded: 0,
    items: [],
    tables: [],
    openCalls: 0,
    requests: [],
    tenantOfOwner: false,
    waiterMember: false,
    sessionOpen: null,
    signIns: [],
    ...world,
  };
  let counter = 0;
  const admin: AdminPort = {
    findUserId: async (email) => w.users.get(email) ?? null,
    createUser: async (email, password) => {
      const id = `user-${w.users.size + 1}`;
      w.users.set(email, id);
      w.passwords.set(id, password);
      return id;
    },
    setPassword: async (id, password) => void w.passwords.set(id, password),
    createTenant: async () => {
      w.tenantCreated += 1;
      w.tenantOfOwner = true;
    },
    addWaiter: async () => {
      w.waiterAdded += 1;
      w.waiterMember = true;
    },
  };
  const ok = (json: unknown, status = 200): Reply => ({ status, json, ms: 10, serverTiming: null });
  let clock = 1_000;
  const ports: PerfPorts = {
    admin,
    signIn: async (role) => void w.signIns.push(role),
    request: async (role, method, path, body) => {
      w.requests.push({ role, method, path, body });
      const scripted = reply(role, method, path, body, w);
      if (scripted) return scripted;
      if (path === "/api/me") {
        const member = role === "owner" ? w.tenantOfOwner : w.waiterMember;
        return member
          ? ok({
              user: { id: "u", displayName: "x", role },
              tenant: { id: TENANT, name: PERF_TENANT_NAME },
            })
          : ok({ error: { code: "no_tenant" } }, 403);
      }
      if (path === "/api/menu/items" && method === "GET") return ok({ items: w.items });
      if (path === "/api/menu/items" && method === "POST") {
        const b = body as { name: string; course: string };
        const item = { id: `item-${w.items.length + 1}`, name: b.name, course: b.course };
        w.items.push(item);
        return ok({ item }, 201);
      }
      if (path === "/api/dining-tables" && method === "GET") return ok({ tables: w.tables });
      if (path === "/api/dining-tables" && method === "POST") {
        const table = { id: `table-${w.tables.length + 1}`, name: (body as { name: string }).name };
        w.tables.push(table);
        return ok({ table }, 201);
      }
      if (path === "/api/menu" && method === "GET") {
        return ok({
          pinned: [],
          categories: [{ name: "x", items: w.items.map((i) => ({ ...i, category: "x" })) }],
        });
      }
      if (/\/api\/tables\/[^/]+\/open$/.test(path)) {
        w.openCalls += 1;
        if (w.sessionOpen) {
          return ok(
            { error: { code: "table_already_open", details: { session: { id: w.sessionOpen } } } },
            409,
          );
        }
        w.sessionOpen = (body as { sessionId: string }).sessionId;
        return ok({ created: true, session: { id: w.sessionOpen } }, 201);
      }
      if (/\/lines$/.test(path) && method === "POST") return ok({ created: true }, 201);
      return ok({ ok: true });
    },
    newPassword: () => `pw-${++counter}`,
    newId: () => `id-${++counter}`,
    nowMs: () => (clock += 5),
    stamp: () => new Date("2026-11-02T19:30:00.000Z"),
  };
  return { ports, world: w };
}

describe("provision", () => {
  it("creates the accounts, the tenant, the staff member, the menu, the table and one open session", async () => {
    const { ports, world } = fakePorts();
    const fx = await provision(ports);
    expect(world.users.size).toBe(2);
    expect(world.tenantCreated).toBe(1);
    expect(world.waiterAdded).toBe(1);
    expect(world.items).toHaveLength(PERF_ITEM_COUNT);
    expect(world.tables).toHaveLength(1);
    expect(fx.tenantId).toBe(TENANT);
    expect(fx.items).toHaveLength(PERF_ITEM_COUNT);
    expect(fx.sessionId).toBe(world.sessionOpen);
    expect(new Set(fx.items.map((i) => i.course)).size).toBe(5);
  });

  it("is idempotent: a second run reuses the tenant, the staff, the items, the table and the session", async () => {
    const { ports, world } = fakePorts();
    const first = await provision(ports);
    const second = await provision(ports);
    expect(world.users.size).toBe(2);
    expect(world.tenantCreated).toBe(1);
    expect(world.waiterAdded).toBe(1);
    expect(world.items).toHaveLength(PERF_ITEM_COUNT);
    expect(world.tables).toHaveLength(1);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
    expect(world.openCalls).toBe(2);
  });

  it("gives both accounts a fresh password on every run, and stores none", async () => {
    const { ports, world } = fakePorts();
    await provision(ports);
    const afterFirst = [...world.passwords.values()];
    await provision(ports);
    const afterSecond = [...world.passwords.values()];
    expect(afterSecond).not.toEqual(afterFirst);
    expect(new Set(afterSecond).size).toBe(2);
  });

  it("signs in again after the tenant and the membership exist (the claims come with the sign-in)", async () => {
    const { ports, world } = fakePorts();
    await provision(ports);
    expect(world.signIns.filter((r) => r === "owner")).toHaveLength(2);
    expect(world.signIns.filter((r) => r === "waiter")).toHaveLength(2);
  });

  it("refuses to write into a tenant that is not the perf tenant", async () => {
    const { ports, world } = fakePorts((role, _m, path) =>
      path === "/api/me" && role === "owner"
        ? {
            status: 200,
            json: {
              user: { id: "u", displayName: "x", role: "owner" },
              tenant: { id: TENANT, name: "Osteria Vera" },
            },
            ms: 1,
            serverTiming: null,
          }
        : null,
    );
    await expect(provision(ports)).rejects.toThrow(/tenant/i);
    expect(world.items).toHaveLength(0);
    expect(world.requests.some((r) => r.method !== "GET")).toBe(false);
  });

  it("stops with the HTTP status only when a setup call fails", async () => {
    const { ports } = fakePorts((_r, method, path) =>
      path === "/api/menu/items" && method === "POST"
        ? {
            status: 500,
            json: { error: { message: "boom secret-text" } },
            ms: 1,
            serverTiming: null,
          }
        : null,
    );
    const error = await provision(ports).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("500");
    expect((error as Error).message).not.toContain("secret-text");
  });

  it("opens the table with the waiter's own session and reuses an open one", async () => {
    const { ports, world } = fakePorts();
    await provision(ports);
    const open = world.requests.filter((r) => /\/open$/.test(r.path));
    expect(open).toHaveLength(1);
    expect(open[0]!.role).toBe("waiter");
    expect(open[0]!.body).toMatchObject({ covers: 2 });
    expect(world.requests.filter((r) => r.role === "waiter" && r.path === "/api/me")).toHaveLength(
      2,
    );
  });
});

describe("measure", () => {
  const fx = {
    tenantId: TENANT,
    sessionId: "session-1",
    items: Array.from({ length: 5 }, (_, i) => ({
      id: `item-${i}`,
      name: `Piatto ${i}`,
      course: ["antipasti", "primi", "secondi", "dolci", "bevande"][i]!,
    })),
  };

  it("runs add, edit, move, remove, menu and lines once per iteration, in that order, as the waiter", async () => {
    const { ports, world } = fakePorts();
    await measure(ports, fx, 3);
    const calls = world.requests.map(
      (r) => `${r.role} ${r.method} ${r.path.replace(/id-\d+/, ":line")}`,
    );
    expect(calls).toHaveLength(18);
    expect(calls.slice(0, 6)).toEqual([
      "waiter POST /api/table-sessions/session-1/lines",
      "waiter PATCH /api/order-lines/:line",
      "waiter PATCH /api/order-lines/:line",
      "waiter POST /api/order-lines/:line/remove",
      "waiter GET /api/menu",
      "waiter GET /api/table-sessions/session-1/lines",
    ]);
  });

  it("sends a new line id per iteration and a stamp that never goes back, in the past", async () => {
    const { ports, world } = fakePorts();
    await measure(ports, fx, 4);
    const adds = world.requests.filter((r) => r.method === "POST" && /\/lines$/.test(r.path));
    expect(new Set(adds.map((a) => (a.body as { lineId: string }).lineId)).size).toBe(4);
    const stamps = world.requests
      .map((r) => (r.body as { clientUpdatedAt?: string } | undefined)?.clientUpdatedAt)
      .filter((s): s is string => Boolean(s))
      .map((s) => Date.parse(s));
    for (let i = 1; i < stamps.length; i += 1) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]!);
    expect(stamps[0]).toBeLessThan(Date.parse("2026-11-02T19:30:00.000Z"));
  });

  it("moves the line to another course than the dish's own", async () => {
    const { ports, world } = fakePorts();
    await measure(ports, fx, 2);
    const moves = world.requests.filter(
      (r) => r.method === "PATCH" && "course" in (r.body as object),
    );
    expect(moves).toHaveLength(2);
    for (const move of moves) expect((move.body as { course: string }).course).toMatch(/^[a-z]+$/);
  });

  it("collects wall time and the Server-Timing parts per action, and counts non-2xx answers", async () => {
    let n = 0;
    const { ports } = fakePorts((_r, method, path) => {
      if (method === "POST" && path.endsWith("/lines")) {
        n += 1;
        return {
          status: n === 2 ? 409 : 201,
          json: {},
          ms: 100 + n,
          serverTiming: "auth;dur=10, rpc;dur=20, total;dur=35",
        };
      }
      return null;
    });
    const samples = await measure(ports, fx, 3);
    expect(samples.add.wall).toEqual([101, 102, 103]);
    expect(samples.add.errors).toBe(1);
    expect(samples.add.parts.auth).toEqual([10, 10, 10]);
    expect(samples.add.parts.rpc).toEqual([20, 20, 20]);
    expect(samples.edit.wall).toHaveLength(3);
    expect(samples.edit.errors).toBe(0);
    expect(Object.keys(samples)).toEqual(["add", "edit", "move", "remove", "menu", "lines"]);
  });

  it("goes on after a failure: numbers never stop the run", async () => {
    const { ports } = fakePorts(() => ({ status: 500, json: {}, ms: 9_999, serverTiming: null }));
    const samples = await measure(ports, fx, 3);
    expect(samples.menu.wall).toHaveLength(3);
    expect(samples.menu.errors).toBe(3);
  });
});

describe("renderReport", () => {
  const samples = {
    add: {
      wall: [100, 200, 300],
      errors: 0,
      parts: { auth: [10, 20, 30], rpc: [50, 60, 70], total: [70, 90, 110] },
    },
    edit: { wall: [80], errors: 1, parts: {} as Record<string, number[]> },
  };
  const report = renderReport(samples, { iterations: 3, itemCount: 20 });

  it("has a row per action with p50, p95 and max of the wall time", () => {
    expect(report).toMatch(/\| add \| 3 \| 0 \| 200\.0 \| 300\.0 \| 300\.0 \|/);
    expect(report).toMatch(/\| edit \| 1 \| 1 \| 80\.0 \| 80\.0 \| 80\.0 \|/);
  });

  it("shows the Server-Timing parts, and a dash where the server sent none", () => {
    expect(report).toMatch(/\| add \|.*\| 20\.0 \/ 30\.0 \| 60\.0 \/ 70\.0 \| 90\.0 \/ 110\.0 \|/);
    expect(report).toMatch(/\| edit \|.*\| – \| – \| – \|/);
  });

  it("says where it was measured, that it promises nothing, and what it leaves out", () => {
    expect(report).toContain("Misurato da un runner GitHub, non da un telefono in 4G");
    expect(report).toContain(PERF_TENANT_NAME);
    expect(report).toMatch(/300 ms/);
    expect(report).toMatch(/non promette|nessuna promessa|Nessun valore è una promessa/i);
    expect(report).toMatch(/PIN/);
    expect(report).toMatch(/senza ricetta/);
  });

  it("holds numbers and fixed words only", () => {
    expect(report).not.toMatch(/https?:\/\//);
    expect(report).not.toMatch(/cookie|password|secret|token|@/i);
  });
});

describe("run", () => {
  it("prints the report, returns 0 and keeps passwords out of the output", async () => {
    const { ports } = fakePorts();
    const out: string[] = [];
    const code = await run(ports, { iterations: 2, write: (line) => out.push(line) });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Misurato da un runner GitHub");
    expect(text).not.toMatch(/pw-\d+/);
  });

  it("returns 0 whatever the numbers are, slow or failing", async () => {
    // Writes of the measured actions fail and the order reads are very slow; the setup's own calls are untouched.
    const { ports } = fakePorts((_r, method, path) =>
      path.startsWith("/api/order-lines") || (method === "POST" && path.endsWith("/lines"))
        ? { status: 500, json: {}, ms: 1, serverTiming: null }
        : method === "GET" && path.startsWith("/api/table-sessions/")
          ? { status: 200, json: {}, ms: 123_456, serverTiming: null }
          : null,
    );
    const out: string[] = [];
    expect(await run(ports, { iterations: 2, write: (line) => out.push(line) })).toBe(0);
    expect(out.join("\n")).toContain("123456.0");
    expect(out.join("\n")).toMatch(/\| add \| 2 \| 2 \|/);
  });

  it("returns 1 with a short message when the setup cannot be done", async () => {
    const { ports } = fakePorts(() => ({ status: 500, json: {}, ms: 1, serverTiming: null }));
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(ports, {
      iterations: 2,
      write: (line) => out.push(line),
      writeError: (line) => err.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err.join(" ")).toMatch(/Setup/);
    expect(err.join(" ")).not.toMatch(/pw-\d+/);
  });
});
