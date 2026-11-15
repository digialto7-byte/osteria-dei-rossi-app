import { describe, expect, it, vi } from "vitest";
import { runPlatformAdmin, type PlatformAdminClient } from "../../scripts/lib/platform-admin";

// SP3 step 7 (plan 3.9.1): scripts/platform-admin.ts bootstrap. The address comes from the environment secret PLATFORM_ADMIN_EMAIL, never from an argument; it is never
// printed, logged or put in an error. The script makes exactly one writing call (platform_bootstrap_admin writes the staff row and the audit row itself).
const EMAIL = "platform.admin@example.test";
const AUTH = "a5000000-0000-4000-8000-000000000001";
const OTHER = "a5000000-0000-4000-8000-000000000002";
const ENV = { PLATFORM_ADMIN_EMAIL: EMAIL };

type User = { id: string; email?: string | null };
type Err = { message: string; code?: string } | null;
interface Setup {
  /** The users of each page, in order; a page past the end is empty. */
  pages?: User[][];
  listError?: { message: string; code?: string };
  rpc?: { data: unknown; error: Err };
}
function harness(setup: Setup = {}) {
  const pages = setup.pages ?? [[{ id: AUTH, email: EMAIL }]];
  const listUsers = vi.fn(async (params: { page: number; perPage: number }) =>
    setup.listError
      ? { data: { users: [] as User[] }, error: setup.listError }
      : { data: { users: pages[params.page - 1] ?? [] }, error: null as Err },
  );
  const rpc = vi.fn(
    async (_fn: string, _args: Record<string, unknown>) =>
      setup.rpc ?? {
        data: { authId: AUTH, hasVerifiedFactor: false },
        error: null as Err,
      },
  );
  const admin = { rpc, auth: { admin: { listUsers } } };
  const make = vi.fn(() => admin as unknown as PlatformAdminClient);
  const out: string[] = [];
  const err: string[] = [];
  return {
    listUsers,
    rpc,
    make,
    out,
    err,
    all: () => [...out, ...err].join("\n"),
    run: (argv: string[], env: Record<string, string | undefined> = ENV) =>
      runPlatformAdmin(argv, env, {
        admin: make,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      }),
  };
}

describe("platform-admin bootstrap with PLATFORM_ADMIN_EMAIL", () => {
  it("prints {authId, hasVerifiedFactor} and the captured stdout, stderr and thrown errors contain no @", async () => {
    const h = harness();
    expect(await h.run(["bootstrap"])).toBe(0);
    expect(h.out[0]).toBe(JSON.stringify({ authId: AUTH, hasVerifiedFactor: false }));
    expect(h.all()).not.toContain("@");
    expect(h.all()).not.toContain(EMAIL);
  });

  it("hasVerifiedFactor false adds the next line; true does not", async () => {
    const no = harness();
    await no.run(["bootstrap"]);
    expect(no.out.join("\n")).toContain("next: sign in on the console host and set up the code");
    const yes = harness({ rpc: { data: { authId: AUTH, hasVerifiedFactor: true }, error: null } });
    expect(await yes.run(["bootstrap"])).toBe(0);
    expect(yes.out).toEqual([JSON.stringify({ authId: AUTH, hasVerifiedFactor: true })]);
  });

  it("calls platform_bootstrap_admin exactly once, with the auth id found, and nothing else writes (AT8)", async () => {
    const h = harness();
    await h.run(["bootstrap"]);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("platform_bootstrap_admin", { p_auth: AUTH });
  });

  it("compares the address in memory, ignoring case and surrounding spaces", async () => {
    const h = harness({
      pages: [
        [
          { id: OTHER, email: "x@example.test" },
          { id: AUTH, email: "Platform.Admin@Example.TEST" },
        ],
      ],
    });
    expect(await h.run(["bootstrap"], { PLATFORM_ADMIN_EMAIL: ` ${EMAIL} ` })).toBe(0);
    expect(h.rpc).toHaveBeenCalledWith("platform_bootstrap_admin", { p_auth: AUTH });
  });

  it("the lookup pages until found and stops there", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({
      id: OTHER,
      email: `p${i}@example.test`,
    }));
    const h = harness({ pages: [full, full, [{ id: AUTH, email: EMAIL }], full] });
    expect(await h.run(["bootstrap"])).toBe(0);
    expect(h.listUsers).toHaveBeenCalledTimes(3);
    expect(h.listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 200 });
    expect(h.listUsers).toHaveBeenNthCalledWith(3, { page: 3, perPage: 200 });
  });

  it("an unknown address exits 1 without echoing it, without calling the database function", async () => {
    const h = harness({ pages: [[{ id: OTHER, email: "someone.else@example.test" }]] });
    expect(await h.run(["bootstrap"])).toBe(1);
    expect(h.err.join("\n")).toContain("no auth user for the given address");
    expect(h.all()).not.toContain("@");
    expect(h.all()).not.toContain(EMAIL);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.out).toEqual([]);
  });

  it("stops after the last page when the address is not there (a short page ends the lookup)", async () => {
    const full = Array.from({ length: 200 }, () => ({ id: OTHER, email: "x@example.test" }));
    const h = harness({ pages: [full, [{ id: OTHER, email: "y@example.test" }]] });
    expect(await h.run(["bootstrap"])).toBe(1);
    expect(h.listUsers).toHaveBeenCalledTimes(2);
  });

  it("a lookup that never ends is cut off with a code, not looped forever", async () => {
    const full = Array.from({ length: 200 }, () => ({ id: OTHER, email: "x@example.test" }));
    const h = harness();
    h.listUsers.mockImplementation(async () => ({ data: { users: full }, error: null as Err }));
    expect(await h.run(["bootstrap"])).toBe(1);
    expect(h.err.join("\n")).toContain("auth_user_lookup_incomplete");
    expect(h.listUsers.mock.calls.length).toBeLessThanOrEqual(500);
  });

  it("a failing lookup prints its code only, never the raw message", async () => {
    const h = harness({ listError: { message: `boom for ${EMAIL}`, code: "unexpected_failure" } });
    expect(await h.run(["bootstrap"])).toBe(1);
    expect(h.err.join("\n")).toContain("unexpected_failure");
    expect(h.all()).not.toContain("@");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("a missing or blank PLATFORM_ADMIN_EMAIL with no --auth-id exits 1 before any Supabase call, with a fixed message that names the variable and holds no @", async () => {
    for (const env of [{}, { PLATFORM_ADMIN_EMAIL: "" }, { PLATFORM_ADMIN_EMAIL: "   " }]) {
      const h = harness();
      expect(await h.run(["bootstrap"], env)).toBe(1);
      expect(h.err).toEqual([
        "Missing environment variable: PLATFORM_ADMIN_EMAIL (or pass --auth-id).",
      ]);
      expect(h.out).toEqual([]);
      expect(h.all()).not.toContain("@");
      // The injected client is never made, so neither an RPC nor an Auth admin call can have happened.
      expect(h.make).not.toHaveBeenCalled();
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.listUsers).not.toHaveBeenCalled();
    }
  });
});

describe("platform-admin bootstrap --auth-id", () => {
  it("skips the lookup and never reads the address", async () => {
    const h = harness();
    expect(await h.run(["bootstrap", "--auth-id", AUTH], {})).toBe(0);
    expect(h.listUsers).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith("platform_bootstrap_admin", { p_auth: AUTH });
  });

  it("is used even when the address is also set", async () => {
    const h = harness({ pages: [[{ id: OTHER, email: EMAIL }]] });
    expect(await h.run(["bootstrap", "--auth-id", AUTH])).toBe(0);
    expect(h.listUsers).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith("platform_bootstrap_admin", { p_auth: AUTH });
  });

  it.each([["x"], [AUTH.toUpperCase()], [""]])(
    "%j is refused with exit 2 before any call, without being echoed",
    async (value) => {
      const h = harness();
      expect(await h.run(["bootstrap", "--auth-id", value])).toBe(2);
      expect(h.make).not.toHaveBeenCalled();
      if (value !== "") expect(h.all()).not.toContain(value);
    },
  );
});

describe("platform-admin: refusals and output", () => {
  it.each([
    ["a SQL refusal", "platform_admin_exists"],
    ["another SQL refusal", "platform_admin_has_member_role"],
    ["the unknown-user refusal", "auth_user_not_found"],
    ["the named staff refusal", "platform_staff_exists"],
  ])("%s is printed as its code only and the run exits 1", async (_label, code) => {
    const h = harness({ rpc: { data: null, error: { message: code, code: "P0001" } } });
    expect(await h.run(["bootstrap"])).toBe(1);
    expect(h.err.join("\n")).toContain(code);
    expect(h.out).toEqual([]);
  });

  it("an error that is not one of our fixed names is shown as its SQLSTATE only", async () => {
    const h = harness({
      rpc: { data: null, error: { message: `duplicate key for ${EMAIL}`, code: "23505" } },
    });
    expect(await h.run(["bootstrap"])).toBe(1);
    expect(h.err.join("\n")).toContain("23505");
    expect(h.all()).not.toContain("@");
  });

  it("an answer that is not {authId, hasVerifiedFactor} is refused, not printed", async () => {
    for (const data of [
      null,
      { authId: "x", hasVerifiedFactor: true },
      { authId: AUTH },
      { authId: AUTH, hasVerifiedFactor: "yes" },
      { authId: AUTH, hasVerifiedFactor: true, extra: 1 },
    ]) {
      const h = harness({ rpc: { data, error: null } });
      expect(await h.run(["bootstrap"])).toBe(1);
      expect(h.out).toEqual([]);
    }
  });

  it("under GitHub Actions the auth id is masked first and shown as its first 8 characters only", async () => {
    const h = harness();
    expect(await h.run(["bootstrap"], { ...ENV, GITHUB_ACTIONS: "true" })).toBe(0);
    expect(h.out[0]).toBe(`::add-mask::${AUTH}`);
    const shown = h.out.filter((l) => !l.startsWith("::add-mask::")).join("\n");
    expect(shown).not.toContain(AUTH);
    expect(shown).toContain(JSON.stringify({ authId: AUTH.slice(0, 8), hasVerifiedFactor: false }));
    expect(h.all()).not.toContain("@");
  });

  it.each([
    [[]],
    [["notice-add"]],
    [["bootstrap", "--email", EMAIL]],
    [["bootstrap", "extra"]],
    [["bootstrap", "--auth-id"]],
  ])("the arguments %j exit 2 before any call and echo no argument", async (argv) => {
    const h = harness();
    expect(await h.run(argv as string[])).toBe(2);
    expect(h.make).not.toHaveBeenCalled();
    expect(h.all()).not.toContain(EMAIL);
    expect(h.err.join("\n")).toContain("Uso / Usage");
  });
});

describe("platform-admin: a client that throws instead of answering", () => {
  const STACK = `Error: boom for ${EMAIL}\n    at secret/path/file.ts:1:1`;

  it("a throwing platform_bootstrap_admin call prints a fixed code only, under Actions too: no message, no stack, no @", async () => {
    for (const env of [ENV, { ...ENV, GITHUB_ACTIONS: "true" }]) {
      const h = harness();
      h.rpc.mockImplementation(async () => {
        throw Object.assign(new Error(STACK), { stack: STACK });
      });
      expect(await h.run(["bootstrap"], env)).toBe(1);
      expect(h.err).toEqual(["Operazione rifiutata / Refused: unreachable"]);
      expect(h.out.filter((l) => !l.startsWith("::add-mask::"))).toEqual([]);
      expect(h.all()).not.toContain("@");
      expect(h.all()).not.toContain("secret/path");
    }
  });

  it("a throwing user lookup prints a fixed code only", async () => {
    const h = harness();
    h.listUsers.mockImplementation(async () => {
      throw new Error(STACK);
    });
    expect(await h.run(["bootstrap"])).toBe(1);
    expect(h.err).toEqual(["Could not look the account up: unknown_error"]);
    expect(h.all()).not.toContain("@");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
