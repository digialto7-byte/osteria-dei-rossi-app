import { describe, expect, it } from "vitest";
import {
  purgeCurrent,
  runCleanup,
  runPurge,
  type PurgeDeps,
  type StorageEntry,
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
  purged_at: string;
}
const row = (id: number, tenant: string | null, authIds: string[]): Pending => ({
  id,
  tenant_id: tenant,
  tenant_name: NAME,
  auth_ids: authIds,
  purged_at: "2026-10-24T18:00:00Z",
});

interface Setup {
  pending?: Pending[];
  /** folder -> entries; a folder entry has id null. */
  tree?: Record<string, StorageEntry[]>;
  failRemove?: boolean;
  /** auth ids whose delete fails (500). */
  failDelete?: Set<string>;
  /** auth ids that are already gone (404). */
  gone?: Set<string>;
  purgeError?: { code: string; message: string };
  status?: { exists: boolean; tenantId?: string; name?: string };
  pageSize?: number;
}

function makeDeps(setup: Setup = {}) {
  const log: string[] = [];
  const removed: string[][] = [];
  const deleted: string[] = [];
  const done: { p_log: number; p_auth_deleted: number; p_objects_deleted: number }[] = [];
  const listed: string[] = [];
  const pending = [...(setup.pending ?? [])];
  const deps: PurgeDeps = {
    service: {
      async rpc(name, args = {}) {
        log.push(name);
        if (name === "purge_demo_tenant_by_id") {
          if (setup.purgeError) return { data: null, error: setup.purgeError } as never;
          return {
            data: { tenantId: args.p_tenant, rowCounts: { invoice: 5 } },
            error: null,
          } as never;
        }
        if (name === "demo_purge_pending") return { data: [...pending], error: null } as never;
        if (name === "demo_tenant_status") {
          return { data: setup.status ?? { exists: false }, error: null } as never;
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
      async list(folder, options) {
        log.push("storage.list");
        listed.push(folder);
        const all = setup.tree?.[folder] ?? [];
        return { data: all.slice(options.offset, options.offset + options.limit), error: null };
      },
      async remove(paths) {
        log.push("storage.remove");
        removed.push(paths);
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
    pageSize: setup.pageSize,
  };
  return { deps, log, removed, deleted, done, listed, pending };
}

const file = (name: string): StorageEntry => ({ name, id: `obj-${name}` });
const folder = (name: string): StorageEntry => ({ name, id: null });

const TREE: Record<string, StorageEntry[]> = {
  [TENANT]: [folder("2026"), folder("2025")],
  [`${TENANT}/2026`]: [file("a.pdf"), file("b.pdf")],
  [`${TENANT}/2025`]: [file("c.pdf")],
};

describe("runCleanup", () => {
  it("removes the objects, then the Auth users, then reports it done, in that order", async () => {
    const { deps, log, removed, deleted, done } = makeDeps({
      pending: [row(7, TENANT, [AUTH_A, AUTH_B])],
      tree: TREE,
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
      "storage.list",
      "storage.list",
      "storage.list",
      "storage.remove",
      "auth.deleteUser",
      "auth.deleteUser",
      "demo_purge_cleanup_done",
    ]);
    expect(removed.flat().sort()).toEqual([
      `${TENANT}/2025/c.pdf`,
      `${TENANT}/2026/a.pdf`,
      `${TENANT}/2026/b.pdf`,
    ]);
    expect(deleted).toEqual([AUTH_A, AUTH_B]);
    expect(done).toEqual([{ p_log: 7, p_auth_deleted: 2, p_objects_deleted: 3 }]);
  });

  it("with nothing pending calls nothing else and succeeds", async () => {
    const { deps, log } = makeDeps();
    expect(await runCleanup(deps)).toMatchObject({ ok: true, cleaned: 0, failed: 0 });
    expect(log).toEqual(["demo_purge_pending"]);
  });

  it("lists only under the tenant's prefix, never the bucket root, and pages through long folders", async () => {
    const many = Array.from({ length: 7 }, (_, i) => file(`f${i}.pdf`));
    const { deps, listed, removed } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A])],
      tree: { [TENANT]: [folder("2026")], [`${TENANT}/2026`]: many },
      pageSize: 3,
    });
    await runCleanup(deps);
    expect(listed.every((f) => f === TENANT || f.startsWith(`${TENANT}/`))).toBe(true);
    expect(listed).not.toContain("");
    expect(removed.flat()).toHaveLength(7);
    for (const batch of removed) expect(batch.length).toBeLessThanOrEqual(100);
  });

  it("skips a listed path that is not under the tenant's prefix", async () => {
    const { deps, removed, done } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A])],
      tree: {
        [TENANT]: [
          folder("2026"),
          file(`../${OTHER_TENANT}`),
          file("../x.pdf"),
          file(`${OTHER_TENANT}/2026/y.pdf`),
          file("/abs.pdf"),
          file(""),
        ],
        [`${TENANT}/2026`]: [file("a.pdf"), file("..")],
      },
    });
    const result = await runCleanup(deps);
    expect(removed.flat()).toEqual([`${TENANT}/2026/a.pdf`]);
    expect(result.objectsDeleted).toBe(1);
    expect(done[0]!.p_objects_deleted).toBe(1);
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
      pending: [row(1, TENANT, [AUTH_A, AUTH_B, AUTH_C])],
      tree: TREE,
      failDelete: new Set([AUTH_B]),
    });
    const result = await runCleanup(first.deps);
    expect(result).toMatchObject({ ok: false, cleaned: 0, failed: 1, error: "auth_delete_failed" });
    expect(first.done).toEqual([]);
    expect(first.pending).toHaveLength(1);

    // The re-run: the user that was deleted the first time is gone (404) and counts as done.
    const second = makeDeps({
      pending: first.pending,
      tree: TREE,
      gone: new Set([AUTH_A]),
    });
    const again = await runCleanup(second.deps);
    expect(again).toMatchObject({ ok: true, cleaned: 1, failed: 0, authDeleted: 3 });
    expect(second.done).toEqual([{ p_log: 1, p_auth_deleted: 3, p_objects_deleted: 3 }]);
    expect(second.pending).toEqual([]);
  });

  it("a failed Storage remove stops that row before any Auth user is deleted", async () => {
    const { deps, deleted, done } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A])],
      tree: TREE,
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
        pending: [row(1, tenant, [AUTH_A])],
        tree: { "": [folder("somebody-else")], [TENANT]: [file("a.pdf")] },
      });
      const result = await runCleanup(deps);
      expect(result).toMatchObject({ ok: false, failed: 1, error: "invalid_pending_row" });
      expect(log).not.toContain("storage.list");
      expect(removed).toEqual([]);
      expect(deleted).toEqual([]);
      expect(done).toEqual([]);
    },
  );

  it("refuses a pending row whose Auth ids are not UUIDs, without deleting anything for it", async () => {
    const { deps, deleted, removed } = makeDeps({
      pending: [row(1, TENANT, [AUTH_A, "not-a-uuid"])],
      tree: TREE,
    });
    const result = await runCleanup(deps);
    expect(result.error).toBe("invalid_pending_row");
    expect(deleted).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("reports counts only: no Auth id, tenant id or path in the result", async () => {
    const { deps } = makeDeps({ pending: [row(7, TENANT, [AUTH_A])], tree: TREE });
    const text = JSON.stringify(await runCleanup(deps));
    for (const value of [AUTH_A, TENANT, "a.pdf", NAME]) expect(text).not.toContain(value);
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
      pending: [row(3, TENANT, [AUTH_A])],
      tree: TREE,
    });
    const result = await runPurge(deps, TENANT, NAME);
    expect(result).toMatchObject({ ok: true, tenantId: TENANT, counts: { invoice: 5 } });
    expect(log.filter((n) => !n.startsWith("storage.list"))).toEqual([
      "purge_demo_tenant_by_id",
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
      if (name === "purge_demo_tenant_by_id") calls.push(args);
      return rpc(name, args);
    };
    await runPurge(deps, TENANT, NAME);
    expect(calls).toEqual([{ p_tenant: TENANT, p_confirm_name: NAME }]);
  });

  it("a refused purge does no clean-up and reports the code", async () => {
    const { deps, log } = makeDeps({ purgeError: { code: "42501", message: "not_demo_tenant" } });
    const result = await runPurge(deps, TENANT, NAME);
    expect(result).toMatchObject({ ok: false, error: "not_demo_tenant" });
    expect(log).toEqual(["purge_demo_tenant_by_id"]);
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
  it("purges the demo tenant that exists, using the id and name the status gave", async () => {
    const { deps, log } = makeDeps({ status: { exists: true, tenantId: TENANT, name: NAME } });
    const result = await purgeCurrent(deps);
    expect(result.ok).toBe(true);
    expect(log.slice(0, 2)).toEqual(["demo_tenant_status", "purge_demo_tenant_by_id"]);
  });

  it("with no demo it only finishes pending clean-ups", async () => {
    const { deps, log } = makeDeps({ pending: [row(3, TENANT, [AUTH_A])] });
    const result = await purgeCurrent(deps);
    expect(result).toMatchObject({ ok: true, tenantId: null });
    expect(log).not.toContain("purge_demo_tenant_by_id");
    expect(log).toContain("demo_purge_cleanup_done");
  });
});
