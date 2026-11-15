import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createIdDisplay,
  createTenant,
  openIdsFile,
  parseCreateTenantArgs,
  readCreateTenantEnv,
  runCreateTenant,
} from "../../scripts/lib/create-tenant";

// SP3 (review of step 6): the tenant and owner data arrive as environment variables (the platform-ops secrets), never as arguments. Under GitHub Actions an id
// is masked before anything of it is printed and only its first 8 characters are shown; errors are codes only, never a raw Supabase message.
const ENV = {
  TENANT_NAME: "Osteria Demo",
  TENANT_VAT_NUMBER: "IT00000000000",
  OWNER_EMAIL: "owner@example.test",
  OWNER_NAME: "Titolare Demo",
};
const TENANT = "11111111-1111-4111-8111-111111111111";
const OWNER = "a0000000-0000-4000-8000-00000000000a";

function fakeAdmin(
  options: {
    rpcError?: { message: string; code?: string };
    createError?: { message: string; code?: string };
    auditError?: { message: string; code?: string };
  } = {},
) {
  return {
    auth: {
      admin: {
        createUser: vi
          .fn()
          .mockResolvedValue(
            options.createError
              ? { data: { user: null }, error: options.createError }
              : { data: { user: { id: "a0000000-0000-4000-8000-00000000000a" } }, error: null },
          ),
        deleteUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
    // The audit writer answers a row id; every other function answers the tenant id (or the error given).
    rpc: vi.fn(async (fn: string, ..._rest: unknown[]) =>
      fn === "platform_record_script_run"
        ? options.auditError
          ? { data: null, error: options.auditError }
          : { data: 7, error: null }
        : options.rpcError
          ? { data: null, error: options.rpcError }
          : { data: "11111111-1111-4111-8111-111111111111", error: null },
    ),
  };
}

describe("readCreateTenantEnv", () => {
  it("reads the four variables", () => {
    expect(readCreateTenantEnv(ENV)).toEqual({
      name: "Osteria Demo",
      vatNumber: "IT00000000000",
      ownerEmail: "owner@example.test",
      ownerName: "Titolare Demo",
    });
  });

  it("fails before any call when variables are missing or empty, naming them and never a value", () => {
    const { TENANT_NAME: _n, ...rest } = ENV;
    const run = () => readCreateTenantEnv({ ...rest, OWNER_EMAIL: "" });
    expect(run).toThrow(/TENANT_NAME/);
    expect(run).toThrow(/OWNER_EMAIL/);
    try {
      run();
    } catch (error) {
      const text = String(error instanceof Error ? error.message : error);
      for (const value of Object.values(ENV)) expect(text).not.toContain(value);
      expect(text).not.toContain("TENANT_VAT_NUMBER");
      expect(text).not.toContain("OWNER_NAME");
    }
  });

  it("treats a blank (spaces only) variable as missing", () => {
    expect(() => readCreateTenantEnv({ ...ENV, OWNER_NAME: "   " })).toThrow(/OWNER_NAME/);
  });

  it("rejects a VAT number that is not IT + 11 digits, naming the variable and not the value", () => {
    const bad = { ...ENV, TENANT_VAT_NUMBER: "IT123" };
    expect(() => readCreateTenantEnv(bad)).toThrow(/TENANT_VAT_NUMBER/);
    expect(() => readCreateTenantEnv(bad)).not.toThrow(/IT123/);
  });

  it("rejects an invalid owner address without printing it", () => {
    const bad = { ...ENV, OWNER_EMAIL: "not-an-address" };
    expect(() => readCreateTenantEnv(bad)).toThrow(/OWNER_EMAIL/);
    expect(() => readCreateTenantEnv(bad)).not.toThrow(/not-an-address/);
  });
});

describe("parseCreateTenantArgs", () => {
  it("takes no argument, or --ids-out <path> and nothing else", () => {
    expect(parseCreateTenantArgs([])).toEqual({ idsOut: undefined });
    expect(parseCreateTenantArgs(["--ids-out", "/tmp/ids.json"])).toEqual({
      idsOut: "/tmp/ids.json",
    });
  });

  it.each([
    [["--name", "Osteria Demo"]],
    [["--ids-out"]],
    [["--ids-out", ""]],
    [["--ids-out", "a", "--ids-out", "b"]],
    [["--ids-out", "a", "extra"]],
    [["Osteria Demo"]],
  ])("refuses %j without echoing it", (argv) => {
    let message = "";
    try {
      parseCreateTenantArgs(argv);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toMatch(/--ids-out/);
    expect(message).toMatch(/TENANT_NAME/);
    for (const part of argv.filter((p) => p.length > 1 && p !== "--ids-out"))
      expect(message).not.toContain(part);
  });
});

describe("openIdsFile", () => {
  const fresh = () => join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");

  it("creates the file exclusively with mode 0600 and writes the two full ids as JSON", () => {
    const path = fresh();
    const file = openIdsFile(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const reported: string[] = [];
    file.write({ tenantId: TENANT, ownerAuthId: OWNER }, (line) => reported.push(line));
    expect(reported).toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      tenantId: TENANT,
      ownerAuthId: OWNER,
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("fails when the file exists, leaving it untouched", () => {
    const path = fresh();
    writeFileSync(path, "keep");
    expect(() => openIdsFile(path)).toThrow(/ids_out_exists/);
    expect(readFileSync(path, "utf8")).toBe("keep");
  });

  it("discard removes the empty file again", () => {
    const path = fresh();
    const reported: string[] = [];
    openIdsFile(path).discard((line) => reported.push(line));
    expect(existsSync(path)).toBe(false);
    expect(reported).toEqual([]);
  });

  it("refuses a symlink at the path, and its target is not created", () => {
    const dir = mkdtempSync(join(tmpdir(), "ids-"));
    const target = join(dir, "target.json");
    const path = join(dir, "ids.json");
    symlinkSync(target, path);
    expect(() => openIdsFile(path)).toThrow(/ids_out_exists/);
    expect(existsSync(target)).toBe(false);
  });

  it("writes through the descriptor it opened: a symlink put at the path afterwards is not followed", () => {
    const dir = mkdtempSync(join(tmpdir(), "ids-"));
    const target = join(dir, "target.json");
    const path = join(dir, "ids.json");
    const file = openIdsFile(path);
    unlinkSync(path);
    symlinkSync(target, path);
    const reported: string[] = [];
    file.write({ tenantId: TENANT, ownerAuthId: OWNER }, (line) => reported.push(line));
    expect(reported).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

  it("reports a failed removal as a code on the given channel instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ids-"));
    const path = join(dir, "ids.json");
    const file = openIdsFile(path);
    unlinkSync(path);
    mkdirSync(path); // unlink of a directory fails
    const reported: string[] = [];
    expect(() => file.discard((line) => reported.push(line))).not.toThrow();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatch(/^ids_out_not_removed \([A-Z]+\)$/);
    rmSync(path, { recursive: true });
  });
});

describe("createIdDisplay", () => {
  it("locally shows the full id and prints nothing else", () => {
    const written: string[] = [];
    const display = createIdDisplay({}, (line) => written.push(line));
    expect(display.reveal(TENANT)).toBe(TENANT);
    expect(written).toEqual([]);
  });

  it("under GITHUB_ACTIONS=true masks the id first, then shows the 8-character prefix only", () => {
    const written: string[] = [];
    const display = createIdDisplay({ GITHUB_ACTIONS: "true" }, (line) => written.push(line));
    expect(display.reveal(TENANT)).toBe("11111111");
    expect(written).toEqual([`::add-mask::${TENANT}`]);
  });

  it("GITHUB_ACTIONS=false is local", () => {
    expect(createIdDisplay({ GITHUB_ACTIONS: "false" }, () => undefined).reveal(TENANT)).toBe(
      TENANT,
    );
  });
});

describe("createTenant", () => {
  const input = readCreateTenantEnv(ENV);
  const full = createIdDisplay({}, () => undefined);

  it("creates a confirmed auth user, then the tenant and owner in one RPC", async () => {
    const admin = fakeAdmin();
    await expect(createTenant(admin, input, full)).resolves.toEqual({
      tenantId: TENANT,
      ownerAuthId: OWNER,
    });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: "owner@example.test",
      email_confirm: true,
    });
    expect(admin.rpc).toHaveBeenCalledWith("create_tenant_with_owner", {
      tenant_name: "Osteria Demo",
      tenant_vat_number: "IT00000000000",
      owner_auth_id: OWNER,
      owner_display_name: "Titolare Demo",
    });
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes the auth user it created when the tenant cannot be created, and reports a code only", async () => {
    const admin = fakeAdmin({ rpcError: { message: "duplicate key value", code: "23505" } });
    const error = await createTenant(admin, input, full).catch((e: unknown) => e);
    expect(String((error as Error).message)).toMatch(/tenant/i);
    expect((error as Error).message).toContain("23505");
    expect((error as Error).message).not.toContain("duplicate key value");
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(OWNER);
  });

  it("a fixed error name of ours is shown as it is; anything else only as its code", async () => {
    const admin = fakeAdmin({ rpcError: { message: "vat_number_taken", code: "P0001" } });
    await expect(createTenant(admin, input, full)).rejects.toThrow(/vat_number_taken/);
    const raw = fakeAdmin({ rpcError: { message: "boom owner@example.test" } });
    const error = await createTenant(raw, input, full).catch((e: unknown) => e);
    expect((error as Error).message).toContain("unknown_error");
    expect((error as Error).message).not.toContain("owner@example.test");
  });

  it("says so when removing the auth user fails too, naming the id to delete by hand (full locally)", async () => {
    const admin = fakeAdmin({ rpcError: { message: "duplicate key value", code: "23505" } });
    admin.auth.admin.deleteUser.mockResolvedValue({
      data: null,
      error: { message: "network down", code: "x" },
    });
    const error = await createTenant(admin, input, full).catch((e: unknown) => e);
    expect((error as Error).message).toContain(`${OWNER} could NOT be removed`);
    expect((error as Error).message).not.toContain("network down");
  });

  it("under CI the id in that message is the 8-character prefix, and the id was masked first", async () => {
    const written: string[] = [];
    const ci = createIdDisplay({ GITHUB_ACTIONS: "true" }, (line) => written.push(line));
    const admin = fakeAdmin({ rpcError: { message: "x", code: "23505" } });
    admin.auth.admin.deleteUser.mockResolvedValue({
      data: null,
      error: { message: "n", code: "x" },
    });
    const error = await createTenant(admin, input, ci).catch((e: unknown) => e);
    expect(written).toEqual([`::add-mask::${OWNER}`]);
    expect((error as Error).message).toContain("a0000000 could NOT be removed");
    expect((error as Error).message).not.toContain(OWNER);
  });

  it("stops before touching the database when the auth user cannot be created, with a code only", async () => {
    const admin = fakeAdmin({
      createError: { message: "already registered owner@example.test", code: "email_exists" },
    });
    const error = await createTenant(admin, input, full).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/auth user/i);
    expect((error as Error).message).toContain("email_exists");
    expect((error as Error).message).not.toContain("owner@example.test");
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});

// The whole run, as the entry script does it, with a fake admin client and captured output.
describe("runCreateTenant", () => {
  function run(argv: string[], env: Record<string, string | undefined>, admin = fakeAdmin()) {
    const out: string[] = [];
    const err: string[] = [];
    const make = vi.fn(() => admin);
    return {
      admin,
      make,
      out,
      err,
      done: runCreateTenant(argv, env, {
        admin: make,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      }),
    };
  }
  const withoutMasks = (lines: string[]) =>
    lines.filter((l) => !l.startsWith("::add-mask::")).join("\n");

  it.each([
    ["without --ids-out", false],
    ["with --ids-out", true],
  ])(
    "under GITHUB_ACTIONS=true %s no full id reaches stdout or stderr (only the mask command carries one)",
    async (_label, withFile) => {
      const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
      const r = run(withFile ? ["--ids-out", path] : [], { ...ENV, GITHUB_ACTIONS: "true" });
      expect(await r.done).toBe(0);
      const shown = withoutMasks([...r.out, ...r.err]);
      expect(shown).not.toContain(TENANT);
      expect(shown).not.toContain(OWNER);
      expect(r.out.at(-1)).toBe("11111111");
      expect(r.out).toContain(`::add-mask::${TENANT}`);
      if (withFile)
        expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
          tenantId: TENANT,
          ownerAuthId: OWNER,
        });
    },
  );

  it("under GITHUB_ACTIONS=true a failure prints codes only and no full id", async () => {
    const admin = fakeAdmin({ rpcError: { message: "duplicate key value", code: "23505" } });
    admin.auth.admin.deleteUser.mockResolvedValue({
      data: null,
      error: { message: "n", code: "x" },
    });
    const r = run([], { ...ENV, GITHUB_ACTIONS: "true" }, admin);
    expect(await r.done).toBe(1);
    expect(withoutMasks([...r.out, ...r.err])).not.toContain(OWNER);
    expect(r.err.join("\n")).toContain("23505");
  });

  const auditCalls = (admin: ReturnType<typeof fakeAdmin>) =>
    admin.rpc.mock.calls.filter(([fn]) => fn === "platform_record_script_run");

  it("create-tenant writes exactly one platform audit row after a successful run and none after a failed one", async () => {
    const ok = run([], ENV);
    expect(await ok.done).toBe(0);
    expect(auditCalls(ok.admin)).toEqual([
      [
        "platform_record_script_run",
        { p_action: "script.create_tenant", p_tenant: TENANT, p_detail: { tenantId: TENANT } },
      ],
    ]);
    const failed = run([], ENV, fakeAdmin({ rpcError: { message: "x", code: "23505" } }));
    expect(await failed.done).toBe(1);
    expect(auditCalls(failed.admin)).toEqual([]);
    const noUser = run([], ENV, fakeAdmin({ createError: { message: "x", code: "400" } }));
    expect(await noUser.done).toBe(1);
    expect(auditCalls(noUser.admin)).toEqual([]);
  });

  it("the audit row is written after the tenant exists and before the id is printed", async () => {
    const r = run([], ENV);
    expect(await r.done).toBe(0);
    const order = r.admin.rpc.mock.calls.map(([fn]) => fn);
    expect(order).toEqual(["create_tenant_with_owner", "platform_record_script_run"]);
  });

  it.each([
    ["locally", {} as Record<string, string>],
    ["under GitHub Actions", { GITHUB_ACTIONS: "true" } as Record<string, string>],
  ])(
    "%s a failing audit write exits 1 with «audit not written», names no address and no full id, and discards the ids file",
    async (_label, extra) => {
      const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
      const admin = fakeAdmin({
        auditError: { message: "boom owner@example.test", code: "23514" },
      });
      const r = run(["--ids-out", path], { ...ENV, ...extra }, admin);
      expect(await r.done).toBe(1);
      const shown = withoutMasks([...r.out, ...r.err]);
      expect(shown).toContain("audit not written");
      expect(shown).toContain("23514");
      expect(shown).not.toContain("@");
      expect(shown).not.toContain(TENANT);
      expect(shown).not.toContain(OWNER);
      expect(shown).toContain("11111111");
      expect(existsSync(path)).toBe(false);
      expect(r.out).toEqual(extra.GITHUB_ACTIONS === "true" ? [`::add-mask::${TENANT}`] : []);
    },
  );

  it("a successful run prints no address", async () => {
    const r = run([], { ...ENV, GITHUB_ACTIONS: "true" });
    expect(await r.done).toBe(0);
    expect([...r.out, ...r.err].join("\n")).not.toContain("@");
  });

  it("locally the full tenant id is printed, as before", async () => {
    const r = run([], ENV);
    expect(await r.done).toBe(0);
    expect(r.out).toEqual([TENANT]);
  });

  it("an existing --ids-out file stops the run before any call", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    writeFileSync(path, "keep");
    const r = run(["--ids-out", path], ENV);
    expect(await r.done).toBe(1);
    expect(r.make).not.toHaveBeenCalled();
    expect(readFileSync(path, "utf8")).toBe("keep");
  });

  it("a failed removal of the ids file is reported and the exit code and message stay those of the original error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ids-"));
    const path = join(dir, "ids.json");
    const admin = fakeAdmin({ rpcError: { message: "duplicate key value", code: "23505" } });
    admin.rpc.mockImplementation(async () => {
      unlinkSync(path);
      mkdirSync(path); // the file can no longer be removed
      return { data: null, error: { message: "duplicate key value", code: "23505" } };
    });
    const r = run(["--ids-out", path], ENV, admin);
    expect(await r.done).toBe(1);
    expect(r.err[0]).toContain("23505");
    expect(r.err.some((l) => /^ids_out_not_removed \([A-Z]+\)$/.test(l))).toBe(true);
  });

  it("a symlink at --ids-out stops the run before any call and creates no target", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ids-"));
    const target = join(dir, "target.json");
    const path = join(dir, "ids.json");
    symlinkSync(target, path);
    const r = run(["--ids-out", path], ENV);
    expect(await r.done).toBe(1);
    expect(r.make).not.toHaveBeenCalled();
    expect(existsSync(target)).toBe(false);
  });

  it("a failed creation discards the ids file", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    const r = run(
      ["--ids-out", path],
      ENV,
      fakeAdmin({ rpcError: { message: "x", code: "23505" } }),
    );
    expect(await r.done).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("any other argument is refused before any call, without echoing it", async () => {
    const r = run(["--name", "Osteria Demo"], ENV);
    expect(await r.done).toBe(1);
    expect(r.make).not.toHaveBeenCalled();
    expect(r.err.join("\n")).not.toContain("Osteria Demo");
  });

  it("missing variables stop the run before the admin client is made, naming them", async () => {
    const r = run([], { ...ENV, OWNER_EMAIL: "" });
    expect(await r.done).toBe(1);
    expect(r.make).not.toHaveBeenCalled();
    expect(r.err.join("\n")).toContain("OWNER_EMAIL");
  });

  it("an admin client that cannot be made (empty Supabase settings) stops the run before any call", async () => {
    const make = vi.fn(() => {
      throw new Error("Missing environment variables: NEXT_PUBLIC_SUPABASE_URL");
    });
    const err: string[] = [];
    const code = await runCreateTenant([], ENV, {
      admin: make,
      out: () => undefined,
      err: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });
});
