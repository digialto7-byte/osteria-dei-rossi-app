import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The two failures of the ids file that no real file system produces on demand (lead, after the step 6 review, NOTE 4): fchmod failing on the
// descriptor just opened, and the write failing after the tenant exists. node:fs is wrapped so that only the call under test fails.
const failing = vi.hoisted(() => ({ fchmod: null as string | null, write: null as string | null }));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const fail = (code: string) => {
    throw Object.assign(new Error(`fake ${code}`), { code });
  };
  return {
    ...real,
    fchmodSync: (...args: Parameters<typeof real.fchmodSync>) =>
      failing.fchmod ? fail(failing.fchmod) : real.fchmodSync(...args),
    writeSync: ((...args: Parameters<typeof real.writeSync>) =>
      failing.write
        ? fail(failing.write)
        : real.writeSync(...(args as [number, string]))) as typeof real.writeSync,
  };
});

const { openIdsFile, runCreateTenant } = await import("../../scripts/lib/create-tenant");

const ENV = {
  TENANT_NAME: "Osteria Demo",
  TENANT_VAT_NUMBER: "IT00000000000",
  OWNER_EMAIL: "owner@example.test",
  OWNER_NAME: "Titolare Demo",
};
const TENANT = "11111111-1111-4111-8111-111111111111";
const OWNER = "a0000000-0000-4000-8000-00000000000a";

function fakeAdmin() {
  return {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER } }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
    rpc: vi.fn().mockResolvedValue({ data: TENANT, error: null }),
  };
}

afterEach(() => {
  failing.fchmod = null;
  failing.write = null;
});

describe("openIdsFile when fchmod fails", () => {
  it("closes the descriptor, removes the empty file and throws a code", () => {
    const dir = mkdtempSync(join(tmpdir(), "ids-"));
    const path = join(dir, "ids.json");
    failing.fchmod = "EPERM";
    expect(() => openIdsFile(path)).toThrow(/^ids_out_unwritable \(EPERM\)$/);
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("stops the run before any call", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    failing.fchmod = "EPERM";
    const admin = fakeAdmin();
    const make = vi.fn(() => admin);
    const err: string[] = [];
    const code = await runCreateTenant(["--ids-out", path], ENV, {
      admin: make,
      out: () => {},
      err: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(make).not.toHaveBeenCalled();
    expect(err).toEqual(["ids_out_unwritable (EPERM)"]);
    expect(existsSync(path)).toBe(false);
  });
});

describe("runCreateTenant when the ids file cannot be written after the tenant exists", () => {
  function runWith(env: Record<string, string | undefined>) {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    failing.write = "ENOSPC";
    const out: string[] = [];
    const err: string[] = [];
    const done = runCreateTenant(["--ids-out", path], env, {
      admin: () => fakeAdmin(),
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    return { path, out, err, done };
  }
  const RECOVERY =
    "ids_out_write_failed (ENOSPC): the tenant WAS created; its id starts with 11111111. Full id: select id from public.tenant where id::text like '11111111%';";

  it("exits non-zero with the exact recovery line, and removes the partial file", async () => {
    const r = runWith(ENV);
    expect(await r.done).toBe(1);
    expect(r.err).toEqual([RECOVERY]);
    expect(r.out).toEqual([]);
    expect(existsSync(r.path)).toBe(false);
  });

  it("under GITHUB_ACTIONS=true prints the same line, with the id masked first and never in full", async () => {
    const r = runWith({ ...ENV, GITHUB_ACTIONS: "true" });
    expect(await r.done).toBe(1);
    expect(r.err).toEqual([RECOVERY]);
    expect(r.out).toEqual([`::add-mask::${TENANT}`]);
    expect(r.err.join("\n")).not.toContain(TENANT);
  });
});
