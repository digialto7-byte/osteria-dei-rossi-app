import { describe, expect, it } from "vitest";
import {
  purgeCurrent,
  runCleanup,
  runPurge,
  type PurgeDeps,
} from "../../../scripts/lib/demo/purge";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const NAME = "Osteria Demo (dati di prova)";
const AUTH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const AUTH_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const AUTH_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

interface Pending {
  id: number;
  tenant_id: string | null;
  tenant_name: string;
  auth_ids: string[];
  /** The exact Storage paths the reset logged. The clean-up removes these and nothing else. */
  file_paths: string[];
  purged_at: string;
}
const INVOICE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const INVOICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const INVOICE_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const pathOf = (tenant: string, year: number, invoice: string) =>
  `${tenant}/${year}/${invoice}.pdf`;
const PATHS = [
  pathOf(TENANT, 2026, INVOICE_A),
  pathOf(TENANT, 2026, INVOICE_B),
  pathOf(TENANT, 2025, INVOICE_C),
];
const row = (
  id: number,
  tenant: string | null,
  authIds: string[],
  paths: string[] = [],
): Pending => ({
  id,
  tenant_id: tenant,
  tenant_name: NAME,
  auth_ids: authIds,
  file_paths: paths,
  purged_at: "2026-10-24T18:00:00Z",
});

interface Setup {
  pending?: Pending[];
  /** What the bucket holds, as paths. A remove deletes only the paths it is given. */
  bucket?: string[];
  failRemove?: boolean;
  /** auth ids whose delete fails (500). */
  failDelete?: Set<string>;
  /** auth ids that are already gone (404). */
  gone?: Set<string>;
  purgeError?: { code: string; message: string };
  state?: { exists: boolean; tenantId?: string; name?: string; demoSince?: string | null };
}

function makeDeps(setup: Setup = {}) {
  const log: string[] = [];
  const removed: string[][] = [];
  const deleted: string[] = [];
  const done: { p_log: number; p_auth_deleted: number; p_objects_deleted: number }[] = [];
  const bucket = new Set(setup.bucket ?? []);
  const pending = [...(setup.pending ?? [])];
  const deps: PurgeDeps = {
    service: {
      async rpc(name, args = {}) {
        log.push(name);
        if (name === "purge_demo_data_by_id") {
          if (setup.purgeError) return { data: null, error: setup.purgeError } as never;
          return {
            data: { tenantId: args.p_tenant, rowCounts: { invoice: 5 } },
            error: null,
          } as never;
        }
        if (name === "demo_purge_pending") return { data: [...pending], error: null } as never;
        if (name === "demo_tenant_state") {
          return { data: setup.state ?? { exists: false }, error: null } as never;
        }
        if (name === "demo_purge_cleanup_done") {
          done.push(args as never);
          const index = pending.findIndex((p) => p.id === args.p_log);
          if (index >= 0) pending.splice(index, 1);
          return { data: null, error: null };
        }
        return { data: null, error: { code: "42883", message: "unknown_rpc" } };
      },
    },
    storage: {
      async remove(paths) {
        log.push("storage.remove");
        removed.push(paths);
        if (!setup.failRemove) for (const path of paths) bucket.delete(path);
        return { error: setup.failRemove ? { message: "boom" } : null };
      },
    },
    authAdmin: {
      async deleteUser(id) {
        log.push("auth.deleteUser");
        deleted.push(id);
        if (setup.failDelete?.has(id))
          return { error: { status: 500, code: "unexpected_failure" } };
        if (setup.gone?.has(id)) return { error: { status: 404, code: "user_not_found" } };
        return { error: null };
      },
    },
  };
  return { deps, log, removed, deleted, done, bucket, pending };
}

describe("runCleanup", () => {
  it("removes the logged files, then the Auth users, then reports it done, in that order", async () => {
    const { deps, log, removed, deleted, done } = makeDeps({
      pending: [row(7, TENANT, [AUTH_A, AUTH_B], PATHS)],
      bucket: PATHS,
    });
    const result = await runCleanup(deps);
    expect(result).toMatchObject({
      ok: true,
      cleaned: 1,
      failed: 0,
      objectsDeleted: 3,
      authDeleted: 2,
    });
    expect(log).toEqual([
      "demo_purge_pending",
      "storage.remove",
      "auth.deleteUser",
      "auth.deleteUser",
      "demo_purge_cleanup_done",
    ]);
    expect(removed.flat().sort()).toEqual([...PATHS].sort());
    expect(deleted).toEqual([AUTH_A, AUTH_B]);
    expect(done).toEqual([{ p_log: 7, p_auth_deleted: 2, p_objects_deleted: 3 }]);
  });

  it("with nothing pending calls nothing else and succeeds", async () => {
    const { deps, log } = makeDeps();
    expect(await runCleanup(deps)).toMatchObject({ ok: true, cleaned: 0, failed: 0 });
    expect(log).toEqual(["demo_purge_pending"]);
  });

  it("a file uploaded after the reset survives: only the logged paths are removed, the tenant folder is never listed", async () => {
    // The tenant stays live after the reset, so a real invoice PDF may arrive before the clean-up runs.
    const later = pathOf(TENANT, 2026, "cccccccc-cccc-4ccc-8ccc-ccccccccccc1");
    const { deps, bucket, removed } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A], PATHS)],
      bucket: [...PATHS, later],
    });
    expect("list" in deps.storage).toBe(false);
    await runCleanup(deps);
    expect([...bucket]).toEqual([later]);
    expect(removed.flat()).not.toContain(later);
  });

  it("a path that is not in the log is never touched, whatever else the bucket holds", async () => {
    const strangers = [
      pathOf(OTHER_TENANT, 2026, INVOICE_A),
      `${TENANT}/2026/not-in-the-log.pdf`,
      pathOf(TENANT, 2027, INVOICE_A),
    ];
    const { deps, bucket } = makeDeps({
      pending: [row(1, TENANT, [], [PATHS[0]!])],
      bucket: [...PATHS, ...strangers],
    });
    await runCleanup(deps);
    expect([...bucket].sort()).toEqual([PATHS[1]!, PATHS[2]!, ...strangers].sort());
  });

  it("removes a row's files only for that row, and never another row's", async () => {
    const other = pathOf(OTHER_TENANT, 2026, INVOICE_A);
    const { deps, removed, bucket } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A], [PATHS[0]!]), row(2, OTHER_TENANT, [AUTH_B], [other])],
      bucket: [PATHS[0]!, PATHS[1]!, other],
    });
    await runCleanup(deps);
    expect(removed).toEqual([[PATHS[0]!], [other]]);
    expect([...bucket]).toEqual([PATHS[1]!]);
  });

  it("removes in batches of at most 100", async () => {
    const many = Array.from({ length: 230 }, (_, i) =>
      pathOf(TENANT, 2026, `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`),
    );
    const { deps, removed, done } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A], many)],
      bucket: many,
    });
    await runCleanup(deps);
    expect(removed.map((batch) => batch.length)).toEqual([100, 100, 30]);
    expect(done[0]!.p_objects_deleted).toBe(230);
  });

  it.each([
    ["another tenant's prefix", pathOf(OTHER_TENANT, 2026, INVOICE_A)],
    ["a parent folder", `${TENANT}/../${OTHER_TENANT}/2026/${INVOICE_A}.pdf`],
    ["the bucket root", `${INVOICE_A}.pdf`],
    ["an absolute path", `/${PATHS[0]!}`],
    ["a name that is not an invoice file", `${TENANT}/2026/notes.txt`],
    ["a folder", `${TENANT}/2026`],
    ["an empty path", ""],
  ])("refuses a log row that lists %s, and removes nothing for it", async (_label, bad) => {
    const { deps, removed, deleted, done } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A], [PATHS[0]!, bad])],
      bucket: [PATHS[0]!, bad],
    });
    const result = await runCleanup(deps);
    expect(result).toMatchObject({ ok: false, failed: 1, error: "invalid_pending_row" });
    expect(removed).toEqual([]);
    expect(deleted).toEqual([]);
    expect(done).toEqual([]);
  });

  it("calls delete only for the stored ids of the pending rows", async () => {
    const { deps, deleted } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A, AUTH_B]), row(2, OTHER_TENANT, [AUTH_C])],
    });
    await runCleanup(deps);
    expect(deleted).toEqual([AUTH_A, AUTH_B, AUTH_C]);
  });

  it("a failed Auth delete leaves the row pending, reports the failure and a re-run finishes it", async () => {
    const first = makeDeps({
      pending: [row(1, TENANT, [AUTH_A, AUTH_B, AUTH_C], PATHS)],
      bucket: PATHS,
      failDelete: new Set([AUTH_B]),
    });
    const result = await runCleanup(first.deps);
    expect(result).toMatchObject({ ok: false, cleaned: 0, failed: 1, error: "auth_delete_failed" });
    expect(first.done).toEqual([]);
    expect(first.pending).toHaveLength(1);

    // The re-run: the user that was deleted the first time is gone (404) and counts as done.
    const second = makeDeps({
      pending: first.pending,
      bucket: PATHS,
      gone: new Set([AUTH_A]),
    });
    const again = await runCleanup(second.deps);
    expect(again).toMatchObject({ ok: true, cleaned: 1, failed: 0, authDeleted: 3 });
    expect(second.done).toEqual([{ p_log: 1, p_auth_deleted: 3, p_objects_deleted: 3 }]);
    expect(second.pending).toEqual([]);
  });

  it("a failed Storage remove stops that row before any Auth user is deleted", async () => {
    const { deps, deleted, done } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A], PATHS)],
      bucket: PATHS,
      failRemove: true,
    });
    const result = await runCleanup(deps);
    expect(result).toMatchObject({ ok: false, failed: 1, error: "storage_remove_failed" });
    expect(deleted).toEqual([]);
    expect(done).toEqual([]);
  });

  it("goes on with the other rows after one fails", async () => {
    const { deps, done } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A]), row(2, OTHER_TENANT, [AUTH_B])],
      failDelete: new Set([AUTH_A]),
    });
    const result = await runCleanup(deps);
    expect(result).toMatchObject({ ok: false, cleaned: 1, failed: 1 });
    expect(done.map((d) => d.p_log)).toEqual([2]);
  });

  it.each([null, "", "not-a-uuid", "../x", `${TENANT}/..`])(
    "never removes anything for a pending row with the tenant id %j",
    async (tenant) => {
      const { deps, log, removed, deleted, done } = makeDeps({
        pending: [row(1, tenant, [AUTH_A], [PATHS[0]!])],
        bucket: [PATHS[0]!],
      });
      const result = await runCleanup(deps);
      expect(result).toMatchObject({ ok: false, failed: 1, error: "invalid_pending_row" });
      expect(removed).toEqual([]);
      expect(deleted).toEqual([]);
      expect(done).toEqual([]);
    },
  );

  it("refuses a pending row whose Auth ids are not UUIDs, without deleting anything for it", async () => {
    const { deps, deleted, removed } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A, "not-a-uuid"], PATHS)],
      bucket: PATHS,
    });
    const result = await runCleanup(deps);
    expect(result.error).toBe("invalid_pending_row");
    expect(deleted).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("reports counts only: no Auth id, tenant id or path in the result", async () => {
    const { deps } = makeDeps({ pending: [row(7, TENANT, [AUTH_A], PATHS)], bucket: PATHS });
    const text = JSON.stringify(await runCleanup(deps));
    for (const value of [AUTH_A, TENANT, "a.pdf", INVOICE_A, NAME])
      expect(text).not.toContain(value);
  });

  it("reports a failed read of the pending list", async () => {
    const { deps } = makeDeps();
    deps.service.rpc = async () => ({ data: null, error: { code: "42501", message: "x y" } });
    expect(await runCleanup(deps)).toMatchObject({ ok: false, error: "sqlstate_42501" });
  });
});

describe("runPurge", () => {
  it("purges in the database first, then removes Storage and Auth, then reports done", async () => {
    const { deps, log } = makeDeps({
      pending: [row(3, TENANT, [AUTH_A], PATHS)],
      bucket: PATHS,
    });
    const result = await runPurge(deps, TENANT, NAME);
    expect(result).toMatchObject({ ok: true, tenantId: TENANT, counts: { invoice: 5 } });
    expect(log).toEqual([
      "purge_demo_data_by_id",
      "demo_purge_pending",
      "storage.remove",
      "auth.deleteUser",
      "demo_purge_cleanup_done",
    ]);
  });

  it("passes the id and the name to the procedure and nothing else", async () => {
    const calls: unknown[] = [];
    const { deps } = makeDeps();
    const rpc = deps.service.rpc;
    deps.service.rpc = async (name, args) => {
      if (name === "purge_demo_data_by_id") calls.push(args);
      return rpc(name, args);
    };
    await runPurge(deps, TENANT, NAME);
    expect(calls).toEqual([{ p_tenant: TENANT, p_confirm_name: NAME }]);
  });

  it("a refused purge does no clean-up and reports the code", async () => {
    const { deps, log } = makeDeps({ purgeError: { code: "42501", message: "not_demo_tenant" } });
    const result = await runPurge(deps, TENANT, NAME);
    expect(result).toMatchObject({ ok: false, error: "not_demo_tenant" });
    expect(log).toEqual(["purge_demo_data_by_id"]);
  });

  it("refuses a tenant id that is not a UUID before calling anything", async () => {
    const { deps, log } = makeDeps();
    expect(await runPurge(deps, "../x", NAME)).toMatchObject({
      ok: false,
      error: "invalid_tenant",
    });
    expect(log).toEqual([]);
  });

  it("a failed clean-up after a good purge is a failure that a re-run of --cleanup can finish", async () => {
    const { deps } = makeDeps({
      pending: [row(3, TENANT, [AUTH_A])],
      failDelete: new Set([AUTH_A]),
    });
    const result = await runPurge(deps, TENANT, NAME);
    expect(result).toMatchObject({ ok: false, tenantId: TENANT, error: "auth_delete_failed" });
  });
});

describe("purgeCurrent", () => {
  const marked = { exists: true, tenantId: TENANT, name: NAME, demoSince: "2026-10-20T10:00:00Z" };

  it("resets the tenant it was given when it carries demo data, using the name the state gave", async () => {
    const { deps, log } = makeDeps({ state: marked });
    const result = await purgeCurrent(deps, TENANT);
    expect(result.ok).toBe(true);
    expect(log.slice(0, 2)).toEqual(["demo_tenant_state", "purge_demo_data_by_id"]);
  });

  it("asks about that tenant only", async () => {
    const asked: unknown[] = [];
    const { deps } = makeDeps({ state: marked });
    const rpc = deps.service.rpc.bind(deps.service);
    deps.service.rpc = (async (name: string, args?: Record<string, unknown>) => {
      if (name === "demo_tenant_state") asked.push(args);
      return rpc(name, args);
    }) as never;
    await purgeCurrent(deps, TENANT);
    expect(asked).toEqual([{ p_tenant: TENANT }]);
  });

  it("a tenant without the marker is never reset: only pending clean-ups run", async () => {
    const { deps, log } = makeDeps({
      state: { exists: true, tenantId: TENANT, name: NAME, demoSince: null },
      pending: [row(3, TENANT, [AUTH_A])],
    });
    const result = await purgeCurrent(deps, TENANT);
    expect(result).toMatchObject({ ok: true, tenantId: null });
    expect(log).not.toContain("purge_demo_data_by_id");
    expect(log).toContain("demo_purge_cleanup_done");
  });

  it("an unknown tenant only finishes pending clean-ups", async () => {
    const { deps, log } = makeDeps({ pending: [row(3, TENANT, [AUTH_A])] });
    const result = await purgeCurrent(deps, TENANT);
    expect(result).toMatchObject({ ok: true, tenantId: null });
    expect(log).not.toContain("purge_demo_data_by_id");
    expect(log).toContain("demo_purge_cleanup_done");
  });
});
