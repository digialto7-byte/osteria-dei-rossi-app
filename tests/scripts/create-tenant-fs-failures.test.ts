import { existsSync, mkdtempSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The two failures of the ids file that no real file system produces on demand (lead, after the step 6 review, NOTE 4): fchmod failing on the
// descriptor just opened, and the write failing after the tenant exists. node:fs is wrapped so that only the call under test fails.
const failing = vi.hoisted(() => ({
  fchmod: null as string | null,
  write: null as string | null,
  close: null as string | null,
  unlink: null as string | null,
  opened: [] as number[],
  closed: [] as number[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const fail = (code: string) => {
    throw Object.assign(new Error(`fake ${code}`), { code });
  };
  return {
    ...real,
    openSync: ((...args: Parameters<typeof real.openSync>) => {
      const fd = real.openSync(...args);
      failing.opened.push(fd);
      return fd;
    }) as typeof real.openSync,
    // A failing close still releases the descriptor, so the test process leaks nothing; the script only sees the error.
    closeSync: (fd: number) => {
      failing.closed.push(fd);
      real.closeSync(fd);
      if (failing.close) fail(failing.close);
    },
    unlinkSync: (path: Parameters<typeof real.unlinkSync>[0]) =>
      failing.unlink ? fail(failing.unlink) : real.unlinkSync(path),
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
  failing.close = null;
  failing.unlink = null;
  failing.opened.length = 0;
  failing.closed.length = 0;
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

  it("closes exactly the descriptor it opened, once", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    failing.fchmod = "EPERM";
    expect(() => openIdsFile(path)).toThrow();
    expect(failing.opened).toHaveLength(1);
    expect(failing.closed).toEqual(failing.opened);
  });

  it("names a failed close in the error and still removes the file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    failing.fchmod = "EPERM";
    failing.close = "EIO";
    expect(() => openIdsFile(path)).toThrow(
      /^ids_out_unwritable \(EPERM\); ids_out_not_closed \(EIO\)$/,
    );
    expect(existsSync(path)).toBe(false);
  });

  it("names a failed removal in the error", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    failing.fchmod = "EPERM";
    failing.unlink = "EACCES";
    expect(() => openIdsFile(path)).toThrow(
      /^ids_out_unwritable \(EPERM\); ids_out_not_removed \(EACCES\)$/,
    );
    expect(existsSync(path)).toBe(true);
    failing.unlink = null;
    unlinkSync(path);
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
    "ids_out_write_failed (ENOSPC): the tenant WAS created; its id starts with 11111111. Full id: select id from public.tenant where id::text like '11111111%'; (check that exactly one row comes back)";

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

  it("when the close after a full write fails: one recovery line, no second close, and the complete file is removed", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    failing.close = "EIO";
    const err: string[] = [];
    const code = await runCreateTenant(["--ids-out", path], ENV, {
      admin: () => fakeAdmin(),
      out: () => {},
      err: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err).toEqual([RECOVERY.replace("ENOSPC", "EIO")]);
    expect(failing.closed).toEqual(failing.opened);
    expect(existsSync(path)).toBe(false);
  });
});

describe("runCreateTenant when the creation fails and the ids file cannot be closed", () => {
  it("reports the failed close, still removes the file, and keeps the original error first", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ids-")), "ids.json");
    const admin = fakeAdmin();
    admin.rpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value", code: "23505" },
    });
    failing.close = "EIO";
    const err: string[] = [];
    const code = await runCreateTenant(["--ids-out", path], ENV, {
      admin: () => admin,
      out: () => {},
      err: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err[0]).toContain("23505");
    expect(err.slice(1)).toEqual(["ids_out_not_closed (EIO)"]);
    expect(existsSync(path)).toBe(false);
  });
});
