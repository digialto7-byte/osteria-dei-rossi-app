import { expect } from "@playwright/test";
import { main } from "../../scripts/lib/demo/main";
import { OWNER_LOCAL_EMAIL } from "../../scripts/lib/demo/fixture";
import { admin } from "./seed-invoice";

// The demo spec's fixtures (docs/plans/2026-10-24-demo-data.md step 14 and §0). The demo is put into an EXISTING tenant (a fresh
// fake one, made by createOwner) by the same `main` the CLI runs: the production procedures, as the demo owner, the chef and the
// service role, with the LOCAL stack's keys injected as the script's environment. Fake data only. Nothing here prints a key, a
// password or an address.

export { OWNER_LOCAL_EMAIL };

export interface DemoRun {
  code: number;
  alerts: string[];
  error?: string;
}

/** Runs the script against the local stack. */
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
  return {
    code,
    alerts: report.alerts ?? [],
    ...(report.error ? { error: report.error } : {}),
  };
}

/**
 * Puts the demo data into the tenant. The demo's Auth accounts are removed first if an earlier test reset the data from the
 * page (the page leaves them to the script's clean-up), because their addresses are fixed.
 */
export async function seedDemo(tenantId: string): Promise<void> {
  expect((await runDemoScript(["--cleanup"])).code).toBe(0);
  const run = await runDemoScript(["--tenant", tenantId, "--reset"]);
  expect({ code: run.code, error: run.error }).toEqual({ code: 0, error: undefined });
}

/** Resets the tenant's demo data and removes the demo accounts, whatever state the test left it in. */
export async function removeDemo(tenantId: string): Promise<void> {
  await runDemoScript(["--tenant", tenantId, "--purge"]);
  await runDemoScript(["--cleanup"]);
}

/** Row counts of a tenant, read with the local secret key from tables the key may read. */
export async function countsOf(tenantId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ["app_user", "audit_event", "location", "invoice"]) {
    const result = await admin()
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    expect(result.error).toBeNull();
    counts[table] = result.count ?? -1;
  }
  return counts;
}

/** The tenant's row: whether it exists and whether it carries demo data. */
export async function tenantState(tenantId: string): Promise<{ exists: boolean; marked: boolean }> {
  const result = await admin().from("tenant").select("id, demo_data_since").eq("id", tenantId);
  expect(result.error).toBeNull();
  const row = (result.data ?? [])[0];
  return { exists: Boolean(row), marked: Boolean(row?.demo_data_since) };
}
