// Demo data entry logic (docs/plans/2026-10-24-demo-data.md §0, §3.4). scripts/demo/seed-demo.ts only calls `main` and sets the
// exit code. Order matters and is tested: environment -> target (local, or staging with the opt-in and the exact host) and the
// tenant id -> keys -> clients. A refusal creates no client at all. Output is one JSON line of counts and masked identities;
// errors print a short sentence that names a variable, never a URL, a key, an address, a password, a PIN or a token.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import { readSupabaseSecretKey } from "@/lib/supabase/admin";
import { romeToday } from "./dates";
import { buildFixture, OWNER_LOCAL_EMAIL } from "./fixture";
import {
  purgeCurrent,
  purgeTenant,
  runCleanup,
  type CleanupResult,
  type PurgeDeps,
  type PurgeResult,
} from "./purge";
import { buildReport, formatReport, type DemoReport } from "./report";
import {
  runSeed,
  SeedError,
  type ClientRole,
  type DemoDb,
  type SeedDeps,
  type SeedOutcome,
  type SignedIn,
} from "./seed";
import { resolveTarget, type ResolvedTarget } from "./target";

export interface MainIo {
  argv: string[];
  env: Record<string, string | undefined>;
  now(): Date;
  stdout(line: string): void;
  stderr(line: string): void;
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;

function wrapDb(role: ClientRole, client: SupabaseClient): DemoDb {
  const failure = (error: { code?: string; message?: string } | null) =>
    error ? { code: error.code, message: error.message } : null;
  return {
    role,
    async rpc(name, args) {
      const { data, error } = await client.rpc(name, args);
      return { data: (data ?? null) as never, error: failure(error) };
    },
    async insert(table, row) {
      const { data, error } = await client.from(table).insert(row).select("id").single();
      return { data: (data ?? null) as never, error: failure(error) };
    },
    async select(table, columns, match = {}) {
      let query = client.from(table).select(columns);
      for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
      const { data, error } = await query;
      return { data: (data ?? null) as never, error: failure(error) };
    },
    async upload(path, bytes) {
      const { data, error } = await client.storage
        .from("invoices")
        .upload(path, bytes, { contentType: "application/pdf" });
      return { data: (data ?? null) as never, error: failure(error) };
    },
  };
}

function sessionIdOf(accessToken: string | undefined): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken?.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { session_id?: unknown };
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

function buildPurgeDeps(admin: SupabaseClient): PurgeDeps {
  return {
    service: wrapDb("service", admin),
    storage: {
      async remove(paths) {
        const { error } = await admin.storage.from("invoices").remove(paths);
        return { error: error ? { message: "remove failed" } : null };
      },
    },
    authAdmin: admin.auth.admin,
  };
}

function buildSeedDeps(
  admin: SupabaseClient,
  purgeDeps: PurgeDeps,
  url: string,
  publishableKey: string,
  now: () => Date,
): SeedDeps {
  return {
    service: wrapDb("service", admin),
    authAdmin: admin.auth.admin,
    async signIn(email, password): Promise<SignedIn> {
      // A fresh, session-less client per user: each one carries only its own session.
      const client = createClient(url, publishableKey, NO_SESSION);
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new SeedError("sign_in_failed", "auth");
      return {
        db: wrapDb(email === OWNER_LOCAL_EMAIL ? "owner" : "chef", client),
        authId: data.session.user.id,
        sessionId: sessionIdOf(data.session.access_token),
        async end() {
          await client.auth.signOut({ scope: "global" });
        },
      };
    },
    now,
    newId: randomUUID,
    newPassword: () => randomBytes(32).toString("base64url"),
    newToken: () => randomBytes(16).toString("hex"),
    sha256Hex: (value) => createHash("sha256").update(value).digest("hex"),
    ownerEmail: OWNER_LOCAL_EMAIL,
    purge: async (tenantId, name) => {
      await purgeTenant(purgeDeps, tenantId, name);
    },
    cleanup: async () => {
      const result = await runCleanup(purgeDeps);
      if (!result.ok) throw new SeedError(result.error ?? "cleanup_failed", "cleanup");
    },
  };
}

const cleanupCounts = (result: CleanupResult) => ({
  cleaned: result.cleaned,
  failed: result.failed,
  auth_deleted: result.authDeleted,
  objects_deleted: result.objectsDeleted,
});

function reportOf(resolved: ResolvedTarget, outcome: SeedOutcome | PurgeResult): DemoReport {
  const base = {
    target: resolved.target,
    mode: resolved.mode,
    ok: outcome.ok,
    tenantId: outcome.tenantId,
    counts: outcome.counts,
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
  };
  if ("logins" in outcome) {
    return buildReport({ ...base, logins: outcome.logins, alerts: outcome.alerts });
  }
  return buildReport({
    ...base,
    counts: { ...outcome.counts, ...cleanupCounts(outcome) },
    logins: [],
    alerts: [],
  });
}

interface Setup {
  resolved: ResolvedTarget;
  url: string;
  publishableKey: string;
  secretKey: string;
}

/** Everything that can be refused before a client exists. Its messages name variables or options, never a value. */
function preflight(io: MainIo): Setup {
  const env = readPublicEnv(io.env);
  // 1. Where may this run? Nothing is created before this answers.
  const resolved = resolveTarget({ argv: io.argv, env: io.env, supabaseUrl: env.supabaseUrl });
  // 2. The keys.
  return {
    resolved,
    url: env.supabaseUrl,
    publishableKey: env.supabasePublishableKey,
    secretKey: readSupabaseSecretKey(io.env),
  };
}

/** Runs the script and returns its exit code. */
export async function main(io: MainIo): Promise<number> {
  let setup: Setup;
  try {
    setup = preflight(io);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : "The demo script was not started.");
    return 1;
  }
  const { resolved } = setup;

  try {
    const admin = createClient(setup.url, setup.secretKey, NO_SESSION);
    const purgeDeps = buildPurgeDeps(admin);

    let report: DemoReport;
    if (resolved.mode === "cleanup") {
      const result = await runCleanup(purgeDeps);
      report = reportOf(resolved, { ...result, tenantId: null, counts: {} });
    } else if (resolved.mode === "purge") {
      report = reportOf(resolved, await purgeCurrent(purgeDeps, resolved.tenantId!));
    } else {
      const deps = buildSeedDeps(admin, purgeDeps, setup.url, setup.publishableKey, io.now);
      const fixture = buildFixture(romeToday(io.now()));
      report = reportOf(
        resolved,
        await runSeed(deps, fixture, {
          tenantId: resolved.tenantId!,
          reset: resolved.mode === "reset",
          force: resolved.force,
        }),
      );
    }
    io.stdout(formatReport(report));
    return report.ok ? 0 : 1;
  } catch {
    // Whatever failed, its message may hold a value; say only that it failed.
    io.stderr("The demo script failed.");
    return 1;
  }
}
