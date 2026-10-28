import { expect } from "@playwright/test";
import { main } from "../../scripts/lib/demo/main";
import { OWNER_LOCAL_EMAIL, TENANT_NAME } from "../../scripts/lib/demo/fixture";
import { admin } from "./seed-invoice";

// The demo spec's fixtures (docs/plans/2026-10-24-demo-data.md step 14). The demo is seeded by the same `main` the CLI
// runs (the production procedures, as the owner, the chef and the service role), with the LOCAL stack's keys injected
// as the script's environment. Fake data only. Nothing here prints a key, a password or an address.

export { OWNER_LOCAL_EMAIL, TENANT_NAME };

export interface DemoRun {
  code: number;
  tenantId: string | null;
  alerts: string[];
}

/** Runs the script against the local stack. `--reset` also works when no demo exists yet. */
export async function runDemoScript(argv: string[]): Promise<DemoRun> {
  const out: string[] = [];
  const code = await main({
    argv,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    },
    now: () => new Date(),
    stdout: (line) => out.push(line),
    stderr: () => undefined,
  });
  const report = out.length > 0 ? (JSON.parse(out[out.length - 1]!) as Partial<DemoRun>) : {};
  return { code, tenantId: report.tenantId ?? null, alerts: report.alerts ?? [] };
}

/** Seeds a fresh demo tenant (any earlier one is purged first) and returns its id. */
export async function seedDemo(): Promise<string> {
  const run = await runDemoScript(["--reset"]);
  expect(run.code).toBe(0);
  expect(run.tenantId).toBeTruthy();
  return run.tenantId!;
}

/** Row counts of a tenant, read with the local secret key from tables the key may read. */
export async function countsOf(tenantId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ["app_user", "audit_event"]) {
    const result = await admin()
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    expect(result.error).toBeNull();
    counts[table] = result.count ?? -1;
  }
  return counts;
}

export async function tenantExists(tenantId: string): Promise<boolean> {
  const result = await admin().from("tenant").select("id").eq("id", tenantId);
  expect(result.error).toBeNull();
  return (result.data ?? []).length === 1;
}

export async function demoTenantCount(): Promise<number> {
  const result = await admin()
    .from("tenant")
    .select("id", { count: "exact", head: true })
    .eq("is_demo", true);
  expect(result.error).toBeNull();
  return result.count ?? -1;
}
