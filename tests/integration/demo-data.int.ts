import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, romeToday } from "../../scripts/lib/demo/dates";
import { buildFixture, OWNER_LOCAL_EMAIL, TENANT_NAME } from "../../scripts/lib/demo/fixture";
import { main } from "../../scripts/lib/demo/main";
import { seedLocation, seedReviewInvoice, seedSupplier } from "./helpers/invoices";
import { quoteUuid, runSql } from "./helpers/sql";
import { createStack, readStackEnv, type Stack } from "./helpers/stack";

// Demo data on the real local stack (docs/plans/2026-10-24-demo-data.md step 11; ADR-018). The script runs for real, through
// the same `main` the CLI calls: it seeds the demo tenant with the production procedures, as the owner, the chef (PIN gate)
// and the service role. Then the demo owner (signed in with a magic link, as the founder will be) reads what the screens read;
// the nightly invariant check is clean; and the owner's purge, DigiAlto's clean-up and the script's --purge/--reset remove the
// demo and nothing else: the two real tenants keep every row and stay append-only.
//
// Rules this file keeps (as the other suites): what a user may read is asserted through that user's session; the secret key
// reads counts, ids and Auth users, never a recipe table; psql is used only for what the API cannot do (the append-only proof).
// No password or key is printed or asserted on: the script's stdout and stderr are scanned for them.
// Tests run in order and share state. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

// Fake data only: the real tenants are "Osteria Demo A" and "B" of the stack helper.
const TODAY = romeToday(new Date());

interface Report {
  target: string;
  mode: string;
  ok: boolean;
  tenantId: string | null;
  counts: Record<string, number>;
  logins: { role: string; name: string; email?: string }[];
  alerts: string[];
  error?: string;
}

async function runDemo(argv: string[]) {
  if (!env) throw new Error("stack settings missing");
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({
    argv,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.publishableKey,
      SUPABASE_SECRET_KEY: env.secretKey,
    },
    now: () => new Date(),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  const text = [...out, ...err].join("\n");
  // Nothing secret is printed, whatever happened.
  expect(text).not.toContain(env.secretKey);
  expect(text).not.toContain(env.publishableKey);
  expect(text).not.toContain(OWNER_LOCAL_EMAIL);
  const report = out.length > 0 ? (JSON.parse(out[out.length - 1]!) as Report) : null;
  return { code, report, err };
}

const CONTENT_TABLES = [
  "alert",
  "app_user",
  "audit_event",
  "auth_attempt",
  "batch",
  "batch_cost",
  "batch_input",
  "batch_movement",
  "count_line",
  "count_session",
  "device_enrolment",
  "fixed_cost_period",
  "ingredient",
  "invoice",
  "invoice_line",
  "location",
  "payable",
  "price_history",
  "raw_lot",
  "recipe",
  "recipe_key",
  "recipe_line",
  "recipe_price",
  "staff_meal_confirmation",
  "staff_meal_rule",
  "staff_session",
  "stock_movement",
  "supplier",
  "supplier_item",
  "tenant",
  "venue_device",
];

describe.skipIf(!env)("demo data on the real stack", () => {
  let stack: Stack;
  let admin: SupabaseClient;
  const before = {} as Record<"a" | "b", { counts: unknown; digest: string }>;
  let demoId = "";

  /** Counts (never rows) of a tenant, with the secret key, through the function made for it. */
  async function countsOf(tenantId: string): Promise<Record<string, number>> {
    const result = await admin.rpc("demo_tenant_row_counts", { p_tenant: tenantId });
    expect(result.error).toBeNull();
    return result.data as Record<string, number>;
  }

  /** A digest of the rows of the ledgers and the login tables of one tenant, to prove they did not change. */
  function digestOf(tenantId: string): string {
    const id = quoteUuid(tenantId);
    return runSql(
      [
        "stock_movement",
        "audit_event",
        "raw_lot",
        "invoice",
        "payable",
        "app_user",
        "venue_device",
        "staff_session",
      ]
        .map(
          (table) =>
            `select '${table}=' || coalesce(md5(string_agg(t::text, ',' order by t::text)), '-') from public.${table} t where t.tenant_id = ${id}`,
        )
        .join(" union all "),
    );
  }

  /** The text of the error psql gives for a statement that must be refused. */
  function refusalOf(statement: string): string {
    try {
      runSql(statement);
    } catch (error) {
      const failure = error as { message?: string; stderr?: Buffer | string };
      return `${failure.message ?? ""}\n${failure.stderr?.toString() ?? ""}`;
    }
    throw new Error("The statement was not refused");
  }

  async function snapshot(tenantId: string) {
    return { counts: await countsOf(tenantId), digest: digestOf(tenantId) };
  }

  /** The demo owner, signed in with a magic link as the founder will be (the password was rotated away). */
  async function signInDemoOwner(): Promise<SupabaseClient> {
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: OWNER_LOCAL_EMAIL,
    });
    expect(link.error).toBeNull();
    const client = createClient(env!.url, env!.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const verified = await client.auth.verifyOtp({
      token_hash: link.data.properties!.hashed_token,
      type: "magiclink",
    });
    expect(verified.error).toBeNull();
    return client;
  }

  async function authIdsOf(tenantId: string): Promise<string[]> {
    const users = await admin.from("app_user").select("auth_id").eq("tenant_id", tenantId);
    expect(users.error).toBeNull();
    return (users.data ?? []).map((u) => u.auth_id as string);
  }

  beforeAll(async () => {
    stack = await createStack(env!);
    admin = stack.admin;
    // Tenant A gets a real stock movement (an approved invoice), so there is a ledger row that must survive everything.
    const tenantId = stack.tenantA.id;
    const supplierId = await seedSupplier(admin, tenantId);
    const locationId = await seedLocation(admin, tenantId);
    const ingredient = await admin
      .from("ingredient")
      .insert({ tenant_id: tenantId, name: "Farina (prova)", base_unit: "kg" })
      .select("id")
      .single();
    expect(ingredient.error).toBeNull();
    const invoiceId = await seedReviewInvoice(admin, tenantId, {
      supplierId,
      date: addDays(TODAY, -2),
      lines: [
        {
          description: "Farina (prova)",
          ingredientId: ingredient.data!.id as string,
          qty: 5,
          unit: "kg",
          unitPrice: 1,
        },
      ],
    });
    const approved = await stack.tenantA.owner.client.rpc("approve_invoice", {
      p_invoice: invoiceId,
      p_location: locationId,
    });
    expect(approved.error).toBeNull();
    before.a = await snapshot(tenantId);
    before.b = await snapshot(stack.tenantB.id);
    expect(Number((before.a.counts as Record<string, number>).stock_movement)).toBeGreaterThan(0);
  }, 120_000);

  const unchanged = async () => {
    expect(await snapshot(stack.tenantA.id)).toEqual(before.a);
    expect(await snapshot(stack.tenantB.id)).toEqual(before.b);
  };

  it("seeds the demo tenant with every area filled", async () => {
    const { code, report, err } = await runDemo([]);
    expect({ code, error: report?.error, err }).toEqual({ code: 0, error: undefined, err: [] });
    expect(report).toMatchObject({ target: "local", mode: "seed", ok: true });
    demoId = report!.tenantId!;
    expect(demoId).toMatch(/^[0-9a-f-]{36}$/);

    // It is flagged, and nothing in the report is a secret: logins are role and name, the owner is masked.
    const flag = await admin.from("tenant").select("is_demo, name").eq("id", demoId).single();
    expect(flag.data).toEqual({ is_demo: true, name: TENANT_NAME });
    expect(report!.logins.find((l) => l.role === "owner")?.email).toBe("t***@e***.test");
    expect(report!.logins.filter((l) => l.role === "chef")).toHaveLength(2);
    expect(report!.logins.filter((l) => l.role === "waiter")).toHaveLength(2);

    const counts = await countsOf(demoId);
    const empty = CONTENT_TABLES.filter((table) => !(counts[table]! > 0));
    expect(empty).toEqual([]);
    expect(counts.tenant).toBe(1);
    expect(counts.invoice).toBe(5);
    expect(counts.location).toBe(2);
    expect(counts.supplier).toBe(3);
    expect(counts.venue_device).toBe(2);
    expect(report!.counts.invoice).toBe(5);
  }, 240_000);

  it("shows the week of the plan to the demo owner", async () => {
    const owner = await signInDemoOwner();
    const fixture = buildFixture(TODAY);

    const locations = await owner.from("location").select("name");
    expect(locations.data).toHaveLength(2);

    const invoices = await owner.from("invoice").select("status");
    expect(invoices.data).toHaveLength(5);
    expect(invoices.data!.filter((i) => i.status === "approved")).toHaveLength(4);
    expect(invoices.data!.filter((i) => i.status === "review")).toHaveLength(1);

    // Payables: one overdue, one due soon, one paid, one open.
    const payables = await owner.from("payable").select("status, due_date");
    expect(payables.data).toHaveLength(4);
    const rows = payables.data!.map((p) => ({
      status: p.status as string,
      due: p.due_date as string,
    }));
    expect(rows.filter((p) => p.status === "paid")).toHaveLength(1);
    expect(rows.filter((p) => p.status === "open" && p.due < TODAY)).toHaveLength(1);
    expect(
      rows.filter((p) => p.status === "open" && p.due >= TODAY && p.due <= addDays(TODAY, 7)),
    ).toHaveLength(1);

    // Recipes: the ragù is at version 2 with a complete food cost.
    const costs = await owner.rpc("recipe_costs");
    expect(costs.error).toBeNull();
    const ragu = (
      costs.data as { name: string; version: number; incomplete: boolean; total_cost_eur: number }[]
    ).find((r) => r.name === "Ragù di manzo (demo)");
    expect(ragu).toMatchObject({ version: 2, incomplete: false });
    expect(Number(ragu!.total_cost_eur)).toBeGreaterThan(0);

    // Stock: the on-hand figures of the fixture, from the ledger.
    const onHand = await owner.rpc("stock_on_hand", { p_location: null });
    expect(onHand.error).toBeNull();
    const byName = new Map<string, number>();
    for (const row of onHand.data as { ingredient_name: string; on_hand_qty: number }[]) {
      byName.set(
        row.ingredient_name,
        (byName.get(row.ingredient_name) ?? 0) + Number(row.on_hand_qty),
      );
    }
    for (const [key, locations] of Object.entries(fixture.expected.onHand)) {
      const name = fixture.ingredients.find((i) => i.key === key)!.name;
      const total = Object.values(locations).reduce((sum, qty) => sum + qty, 0);
      expect(Math.round((byName.get(name) ?? 0) * 1e4) / 1e4).toBe(Math.round(total * 1e4) / 1e4);
    }

    // Portions left: 68 of the ragù.
    const batches = await owner.rpc("batch_list", {
      p_recipe_key: null,
      p_before_at: null,
      p_before_id: null,
      p_limit: 50,
    });
    expect(batches.error).toBeNull();
    const items = (batches.data as { items: { recipeName: string; portionsRemaining: number }[] })
      .items;
    const left = (name: string) =>
      items
        .filter((i) => i.recipeName === name)
        .reduce((sum, i) => sum + Number(i.portionsRemaining), 0);
    expect(left("Ragù di manzo (demo)")).toBe(fixture.expected.portions.ragu);
    expect(left("Crema pasticcera (demo)")).toBe(fixture.expected.portions.crema);

    // The daily count: closed, manzo -0,4, guanciale exact.
    const sessions = await owner.rpc("count_sessions", {
      p_status: "closed",
      p_before_at: null,
      p_before_id: null,
      p_limit: 10,
    });
    expect(sessions.error).toBeNull();
    const closed = (sessions.data as { sessions: { id: string }[] }).sessions;
    expect(closed).toHaveLength(1);
    const variance = await owner.rpc("count_variance", { p_session: closed[0]!.id });
    expect(variance.error).toBeNull();
    const lines = (variance.data as { lines: { name: string; differenceQty: number }[] }).lines;
    expect(lines.find((l) => l.name === "Manzo macinato (demo)")?.differenceQty).toBeCloseTo(
      -0.4,
      4,
    );
    expect(lines.find((l) => l.name === "Guanciale (demo)")?.differenceQty).toBeCloseTo(0, 4);

    // Waste: the raw loss and the batch discard.
    const range = { p_from: addDays(TODAY, -3), p_to: addDays(TODAY, 1) };
    const raw = await owner.rpc("raw_waste_costs", range);
    expect(raw.error).toBeNull();
    expect(Number((raw.data as { valueEur: number }).valueEur)).toBeGreaterThan(0);
    const all = await owner.rpc("waste_costs", range);
    expect(all.error).toBeNull();
    const reasons = (all.data as { reasons: { reasonCode: string }[] }).reasons.map(
      (r) => r.reasonCode,
    );
    expect(reasons).toEqual(expect.arrayContaining(["breakage", "staff_meal", "spoilage"]));
  }, 120_000);

  it("raised the alerts of the plan, and the nightly invariant check finds no drift", async () => {
    const owner = await signInDemoOwner();
    const fixture = buildFixture(TODAY);
    const read = async () => {
      const alerts = await owner.from("alert").select("kind");
      expect(alerts.error).toBeNull();
      return [...new Set(alerts.data!.map((a) => a.kind as string))];
    };
    const kinds = await read();
    for (const kind of fixture.expected.alertKinds) expect(kinds).toContain(kind);
    expect(kinds).not.toContain("ledger_drift");

    // Run the nightly check again, as the cron would: still clean.
    const run = await admin.rpc("ledger_invariants_run", { p_at: new Date().toISOString() });
    expect(run.error).toBeNull();
    expect(await read()).not.toContain("ledger_drift");
  }, 60_000);

  it("a second seed is refused and changes nothing", async () => {
    const { code, report } = await runDemo([]);
    expect(code).toBe(1);
    expect(report).toMatchObject({ ok: false, error: "demo_exists_use_reset" });
    const status = await admin.rpc("demo_tenant_status");
    expect(status.data).toMatchObject({ exists: true, tenantId: demoId });
  }, 60_000);

  it("a real tenant's owner cannot purge, and its ledger cannot be edited", async () => {
    const refused = await stack.tenantA.owner.client.rpc("purge_demo_tenant", {
      p_confirm_name: "Osteria Demo A",
    });
    expect(refused.error?.code).toBe("42501");
    await unchanged();

    const stockId = await admin
      .from("stock_movement")
      .select("id")
      .eq("tenant_id", stack.tenantA.id)
      .limit(1)
      .single();
    expect(stockId.error).toBeNull();
    expect(
      refusalOf(
        `delete from public.stock_movement where id = ${quoteUuid(stockId.data!.id as string)}`,
      ),
    ).toMatch(/append_only/);
    await unchanged();
  }, 60_000);

  it("the demo owner purges the demo with its exact name; the script then removes the logins and files", async () => {
    const owner = await signInDemoOwner();
    // The name must match exactly.
    const wrong = await owner.rpc("purge_demo_tenant", { p_confirm_name: "osteria demo" });
    expect(wrong.error?.message).toBe("confirm_name_mismatch");

    // The fake invoice files exist before the clean-up.
    const before = await admin.storage.from("invoices").list(demoId);
    expect(before.error).toBeNull();
    expect((before.data ?? []).length).toBeGreaterThan(0);

    const purged = await owner.rpc("purge_demo_tenant", { p_confirm_name: TENANT_NAME });
    expect(purged.error).toBeNull();
    expect(Object.values(await countsOf(demoId)).every((count) => count === 0)).toBe(true);
    const pending = await admin.rpc("demo_purge_pending");
    expect(pending.error).toBeNull();
    const rows = pending.data as { tenant_id: string; auth_ids: string[] }[];
    const mine = rows.find((r) => r.tenant_id === demoId)!;
    expect(mine.auth_ids.length).toBeGreaterThanOrEqual(6);

    const cleanup = await runDemo(["--cleanup"]);
    expect({ code: cleanup.code, error: cleanup.report?.error }).toEqual({
      code: 0,
      error: undefined,
    });
    expect(cleanup.report!.counts.cleaned).toBeGreaterThanOrEqual(1);

    expect((await admin.rpc("demo_tenant_status")).data).toEqual({ exists: false });
    for (const id of mine.auth_ids) {
      const gone = await admin.auth.admin.getUserById(id);
      expect(gone.data.user).toBeNull();
      expect(gone.error).not.toBeNull();
    }
    const after = await admin.storage.from("invoices").list(demoId);
    expect(after.error).toBeNull();
    expect(after.data ?? []).toEqual([]);
    expect(((await admin.rpc("demo_purge_pending")).data as unknown[]).length).toBe(0);
    await unchanged();
  }, 240_000);

  it("--reset replaces the demo with a new one, and --purge removes it for go-live", async () => {
    const first = await runDemo([]);
    expect({ code: first.code, error: first.report?.error }).toEqual({ code: 0, error: undefined });
    const firstId = first.report!.tenantId!;

    const reset = await runDemo(["--reset"]);
    expect({ code: reset.code, error: reset.report?.error }).toEqual({ code: 0, error: undefined });
    const secondId = reset.report!.tenantId!;
    expect(secondId).not.toBe(firstId);
    const status = await admin.rpc("demo_tenant_status");
    expect(status.data).toMatchObject({ exists: true, tenantId: secondId });
    expect(await countsOf(firstId)).toMatchObject({ tenant: 0, invoice: 0, stock_movement: 0 });
    const demoTenants = await admin.from("tenant").select("id").eq("is_demo", true);
    expect(demoTenants.data).toHaveLength(1);

    const authIds = await authIdsOf(secondId);
    expect(authIds.length).toBeGreaterThanOrEqual(6);
    const purge = await runDemo(["--purge"]);
    expect({ code: purge.code, error: purge.report?.error }).toEqual({ code: 0, error: undefined });
    expect((await admin.rpc("demo_tenant_status")).data).toEqual({ exists: false });
    for (const id of authIds) {
      expect((await admin.auth.admin.getUserById(id)).data.user).toBeNull();
    }
    expect(((await admin.rpc("demo_purge_pending")).data as unknown[]).length).toBe(0);
    await unchanged();
  }, 480_000);
});
