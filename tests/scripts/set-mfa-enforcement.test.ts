import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runSetMfaEnforcement, type MfaAdminClient } from "../../scripts/lib/mfa-admin";

// P2-1 A13 (docs/plans/2026-11-12-p2-1-totp.md section 3.7, 5 A13): the founder's script that sets the enforcement mode of a tenant. Arguments are parsed strictly before
// any call; the secret key is read by src/lib/supabase/admin.ts only (the entry script passes a factory), and is never printed.
const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "ad100000-0000-4000-8000-0000000000ad";
const ARGS = ["--tenant", TENANT, "--mode", "required", "--actor", ACTOR];
const FAKE_KEY = "test-secret-key-do-not-print-0000";

type RpcResult = {
  data: unknown;
  error: { message: string; code?: string; details?: string | null } | null;
};
function harness(result: RpcResult = { data: { changed: true, mode: "required" }, error: null }) {
  const rpc = vi.fn(async (..._args: unknown[]): Promise<RpcResult> => result);
  const admin = { rpc, auth: { admin: { mfa: { listFactors: vi.fn(), deleteFactor: vi.fn() } } } };
  const make = vi.fn(() => admin as unknown as MfaAdminClient);
  const out: string[] = [];
  const err: string[] = [];
  return {
    rpc,
    make,
    out,
    err,
    run: (argv: string[]) =>
      runSetMfaEnforcement(argv, { admin: make, out: (l) => out.push(l), err: (l) => err.push(l) }),
  };
}

describe("set-mfa-enforcement: arguments", () => {
  it.each([
    ["no arguments", []],
    ["a missing tenant", ["--mode", "required", "--actor", ACTOR]],
    ["a missing mode", ["--tenant", TENANT, "--actor", ACTOR]],
    ["a missing actor", ["--tenant", TENANT, "--mode", "required"]],
    ["a tenant that is not a uuid", ["--tenant", "x", "--mode", "required", "--actor", ACTOR]],
    ["an actor that is not a uuid", ["--tenant", TENANT, "--mode", "required", "--actor", "x"]],
    ["the mode on", ["--tenant", TENANT, "--mode", "on", "--actor", ACTOR]],
    ["an extra flag", [...ARGS, "--force", "yes"]],
    ["a positional argument", [...ARGS, "extra"]],
    ["a flag with no value", ["--tenant", TENANT, "--mode", "--actor", ACTOR]],
    ["the reset script's flag", ["--user", TENANT, "--mode", "required", "--actor", ACTOR]],
  ])("%s exits 2 before any call", async (_name, argv) => {
    const h = harness();
    expect(await h.run(argv)).toBe(2);
    expect(h.make).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.out).toEqual([]);
    expect(h.err.join("\n")).toMatch(/--tenant/);
  });

  it.each(["off", "enrolled", "required"])("accepts the mode %s", async (mode) => {
    const h = harness({ data: { changed: true, mode }, error: null });
    expect(await h.run(["--tenant", TENANT, "--mode", mode, "--actor", ACTOR])).toBe(0);
    expect(h.rpc).toHaveBeenCalledWith("set_mfa_enforcement", {
      p_tenant: TENANT,
      p_mode: mode,
      p_actor: ACTOR,
    });
  });
});

describe("set-mfa-enforcement: the call", () => {
  it("calls the procedure once and prints {changed, mode} only", async () => {
    const h = harness();
    expect(await h.run(ARGS)).toBe(0);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.out).toEqual([JSON.stringify({ changed: true, mode: "required" })]);
    expect(h.err).toEqual([]);
  });

  it("prints changed false for the same mode", async () => {
    const h = harness({ data: { changed: false, mode: "required" }, error: null });
    expect(await h.run(ARGS)).toBe(0);
    expect(h.out).toEqual(['{"changed":false,"mode":"required"}']);
  });

  it("admins_not_enrolled exits 1 with the count, in Italian and English, and prints nothing on stdout", async () => {
    const h = harness({
      data: null,
      error: { message: "admins_not_enrolled", code: "P0001", details: '{"count": 2}' },
    });
    expect(await h.run(ARGS)).toBe(1);
    expect(h.out).toEqual([]);
    const text = h.err.join("\n");
    expect(text).toContain("2");
    expect(text).toMatch(/admin/i);
    expect(text).toMatch(/non hanno ancora/);
    expect(text).toMatch(/have not (turned on|set up)/);
  });

  it("another refusal exits 1 and names only the code", async () => {
    const h = harness({
      data: null,
      error: { message: "actor_invalid", code: "P0001", details: null },
    });
    expect(await h.run(ARGS)).toBe(1);
    expect(h.err.join("\n")).toContain("actor_invalid");
    expect(h.out).toEqual([]);
  });

  it("an unexpected answer exits 1 and prints nothing from it", async () => {
    const h = harness({ data: { surprise: FAKE_KEY }, error: null });
    expect(await h.run(ARGS)).toBe(1);
    expect(h.out.join("") + h.err.join("")).not.toContain(FAKE_KEY);
  });

  it("never prints the secret key, whatever the environment holds", async () => {
    const before = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
    try {
      for (const result of [
        { data: { changed: true, mode: "required" }, error: null },
        { data: null, error: { message: `boom ${"x"}`, code: "XX000", details: null } },
      ] as RpcResult[]) {
        const h = harness(result);
        await h.run(ARGS);
        expect(h.out.join("\n") + h.err.join("\n")).not.toContain(FAKE_KEY);
      }
    } finally {
      if (before === undefined) delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY = before;
    }
  });
});

describe("the scripts and the secret key", () => {
  const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  /** The code of a file without its comment lines, so a comment may name the key. */
  const code = (file: string) =>
    read(file)
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

  it("only the entry scripts create the admin client, through src/lib/supabase/admin.ts; nothing else reads the environment", () => {
    for (const file of ["scripts/set-mfa-enforcement.ts", "scripts/mfa-reset.ts"]) {
      const source = code(file);
      expect(source, file).toContain('createSupabaseAdminClient } from "@/lib/supabase/admin"');
      expect(source, file).not.toMatch(/process\.env|SUPABASE_SECRET_KEY/);
    }
    const lib = code("scripts/lib/mfa-admin.ts");
    expect(lib).not.toMatch(/process\.env|SUPABASE_SECRET_KEY|createClient|supabase\/admin/);
  });

  it("no console output carries a key, a client or an environment dump", () => {
    for (const file of [
      "scripts/set-mfa-enforcement.ts",
      "scripts/mfa-reset.ts",
      "scripts/lib/mfa-admin.ts",
    ]) {
      expect(code(file), file).not.toMatch(/console\.\w+\([^)]*(env|key|admin\b|client)/i);
    }
  });

  it(".env.example gains nothing for the second factor", () => {
    expect(read(".env.example")).not.toMatch(/mfa|totp|factor/i);
  });

  it("package.json is untouched: no new script entry and no new dependency", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts).filter((name) => /mfa/i.test(name))).toEqual([]);
  });
});
