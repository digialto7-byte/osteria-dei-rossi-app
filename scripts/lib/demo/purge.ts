// Demo data purge and clean-up (docs/plans/2026-10-24-demo-data.md §3.1.6, §3.4, §3.8): all I/O injected.
// Postgres removes the tenant (purge_demo_tenant_by_id). It cannot call the Auth or Storage APIs, so this removes, for every
// purge still pending in app.demo_purge_log: the Storage objects under `<tenant>/` first (an object may still name its Auth
// owner), then the Auth users whose ids the log stored, and only then reports the row done. A failure leaves the row pending;
// a re-run finishes it (a user that is already gone counts as deleted). Results hold counts and short codes only: no id, path
// or name.
import { errorCode, SeedError, type AuthAdmin, type DbResult, type DemoDb } from "./seed";

export interface StorageEntry {
  name: string;
  /** Null for a folder. */
  id: string | null;
}

export interface PurgeDeps {
  service: Pick<DemoDb, "rpc">;
  storage: {
    list(
      folder: string,
      options: { limit: number; offset: number },
    ): Promise<{ data: StorageEntry[] | null; error: { message?: string } | null }>;
    remove(paths: string[]): Promise<{ error: { message?: string } | null }>;
  };
  authAdmin: Pick<AuthAdmin, "deleteUser">;
  /** Entries per list call. Tests use a small one to prove paging. */
  pageSize?: number;
}

export interface CleanupResult {
  ok: boolean;
  cleaned: number;
  failed: number;
  authDeleted: number;
  objectsDeleted: number;
  error?: string;
}
export interface PurgeResult extends CleanupResult {
  tenantId: string | null;
  counts: Record<string, number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9._-]+$/;
const PAGE = 100;
const REMOVE_BATCH = 100;
const MAX_DEPTH = 4;

interface PendingRow {
  id: number;
  tenant_id: string | null;
  auth_ids: string[] | null;
}

/** Every file path under `prefix`, recursing into folders. Names that are not plain file names are never returned. */
async function listUnder(deps: PurgeDeps, prefix: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  const limit = deps.pageSize ?? PAGE;
  const paths: string[] = [];
  for (let offset = 0; ; offset += limit) {
    const page = await deps.storage.list(prefix, { limit, offset });
    if (page.error) throw new SeedError("storage_list_failed", "cleanup");
    const entries = page.data ?? [];
    for (const entry of entries) {
      if (!NAME.test(entry.name) || entry.name === "." || entry.name === "..") continue;
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) paths.push(...(await listUnder(deps, path, depth + 1)));
      else paths.push(path);
    }
    if (entries.length < limit) break;
  }
  return paths;
}

async function cleanRow(
  deps: PurgeDeps,
  row: PendingRow,
): Promise<{ auth: number; objects: number }> {
  const tenant = row.tenant_id;
  const authIds = row.auth_ids ?? [];
  if (typeof tenant !== "string" || !UUID.test(tenant) || !authIds.every((id) => UUID.test(id))) {
    throw new SeedError("invalid_pending_row", "cleanup");
  }

  // 1. Storage: only paths under this tenant's own prefix.
  const prefix = `${tenant}/`;
  const paths = (await listUnder(deps, tenant)).filter(
    (path) => path.startsWith(prefix) && !path.slice(prefix.length).split("/").includes(".."),
  );
  for (let at = 0; at < paths.length; at += REMOVE_BATCH) {
    const removed = await deps.storage.remove(paths.slice(at, at + REMOVE_BATCH));
    if (removed.error) throw new SeedError("storage_remove_failed", "cleanup");
  }

  // 2. Auth: only the ids the purge stored. A user that is already gone is done.
  let auth = 0;
  let failed = false;
  for (const id of authIds) {
    const result = await deps.authAdmin.deleteUser(id);
    if (!result.error || result.error.status === 404 || result.error.code === "user_not_found") {
      auth += 1;
    } else {
      failed = true;
    }
  }
  if (failed) throw new SeedError("auth_delete_failed", "cleanup");

  // 3. Only now is the row done.
  const done = await deps.service.rpc("demo_purge_cleanup_done", {
    p_log: row.id,
    p_auth_deleted: auth,
    p_objects_deleted: paths.length,
  });
  if (done.error) throw new SeedError(errorCode(done.error), "cleanup");
  return { auth, objects: paths.length };
}

/** Removes the Auth users and Storage objects of every pending purge. */
export async function runCleanup(deps: PurgeDeps): Promise<CleanupResult> {
  const pending = (await deps.service.rpc<PendingRow[]>("demo_purge_pending")) as DbResult<
    PendingRow[]
  >;
  if (pending.error) {
    return {
      ok: false,
      cleaned: 0,
      failed: 0,
      authDeleted: 0,
      objectsDeleted: 0,
      error: errorCode(pending.error),
    };
  }
  const result: CleanupResult = {
    ok: true,
    cleaned: 0,
    failed: 0,
    authDeleted: 0,
    objectsDeleted: 0,
  };
  for (const row of pending.data ?? []) {
    try {
      const done = await cleanRow(deps, row);
      result.cleaned += 1;
      result.authDeleted += done.auth;
      result.objectsDeleted += done.objects;
    } catch (error) {
      result.ok = false;
      result.failed += 1;
      result.error ??= error instanceof SeedError ? error.code : "cleanup_failed";
    }
  }
  return result;
}

/** The database half of a purge: the tenant and everything of it in Postgres, in one transaction. */
export async function purgeTenant(
  deps: Pick<PurgeDeps, "service">,
  tenantId: string,
  name: string,
): Promise<{ tenantId: string; counts: Record<string, number> }> {
  if (!UUID.test(tenantId)) throw new SeedError("invalid_tenant", "purge");
  const purged = await deps.service.rpc<{ tenantId: string; rowCounts: Record<string, number> }>(
    "purge_demo_tenant_by_id",
    { p_tenant: tenantId, p_confirm_name: name },
  );
  if (purged.error || !purged.data) throw new SeedError(errorCode(purged.error), "purge");
  return { tenantId, counts: purged.data.rowCounts };
}

/** `--purge` for one tenant: the database first, then the Storage and Auth clean-up. */
export async function runPurge(
  deps: PurgeDeps,
  tenantId: string,
  name: string,
): Promise<PurgeResult> {
  let purged: Awaited<ReturnType<typeof purgeTenant>>;
  try {
    purged = await purgeTenant(deps, tenantId, name);
  } catch (error) {
    return {
      ok: false,
      tenantId: null,
      counts: {},
      cleaned: 0,
      failed: 0,
      authDeleted: 0,
      objectsDeleted: 0,
      error: error instanceof SeedError ? error.code : "purge_failed",
    };
  }
  const cleaned = await runCleanup(deps);
  return { ...cleaned, tenantId: purged.tenantId, counts: purged.counts };
}

/** `--purge` as the script runs it: the demo tenant that exists, if any, and every pending clean-up. */
export async function purgeCurrent(deps: PurgeDeps): Promise<PurgeResult> {
  const status = await deps.service.rpc<{ exists: boolean; tenantId?: string; name?: string }>(
    "demo_tenant_status",
  );
  if (status.error) {
    return {
      ok: false,
      tenantId: null,
      counts: {},
      cleaned: 0,
      failed: 0,
      authDeleted: 0,
      objectsDeleted: 0,
      error: errorCode(status.error),
    };
  }
  if (status.data?.exists && status.data.tenantId && status.data.name) {
    return runPurge(deps, status.data.tenantId, status.data.name);
  }
  return { ...(await runCleanup(deps)), tenantId: null, counts: {} };
}
