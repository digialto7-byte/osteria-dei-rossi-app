import { describe, expect, it } from "vitest";
import { addDays } from "../../../scripts/lib/demo/dates";
import { buildFixture } from "../../../scripts/lib/demo/fixture";
import { buildReport, formatReport } from "../../../scripts/lib/demo/report";
import {
  errorCode,
  runSeed,
  type ClientRole,
  type DbResult,
  type DemoDb,
  type SeedDeps,
  type SeedOutcome,
  type SignedIn,
} from "../../../scripts/lib/demo/seed";

const TODAY = "2026-10-24";
const fixture = buildFixture(TODAY);
const OWNER_EMAIL = "titolare.demo@example.test";
/** The target tenant: an existing tenant named by id (a fake one here; the real one's id never enters the repository). */
const TENANT = "11111111-1111-4111-8111-111111111111";
const TARGET_NAME = "Locale Prova (demo)";
type SeedOptions = Parameters<typeof runSeed>[2];
const seed = (deps: SeedDeps, extra: Partial<SeedOptions> = {}) =>
  runSeed(deps, fixture, { tenantId: TENANT, reset: false, force: false, ...extra });
const ok = <T>(data: T): DbResult<T> => ({ data, error: null });
const fail = (message: string, code = "P0001"): DbResult<never> => ({
  data: null,
  error: { code, message },
});

type Order = "forward" | "reverse" | "shuffled";

interface Call {
  client: ClientRole | "auth" | "run";
  kind: "rpc" | "insert" | "select" | "upload" | "auth" | "run";
  name: string;
  args: Record<string, unknown>;
}

interface Options {
  order?: Order;
  /** rpc name -> result, replacing the default answer. */
  override?: Record<string, (args: Record<string, unknown>) => DbResult>;
  alertKinds?: string[];
  /** The answer of demo_tenant_state (defaults to an existing, unmarked, empty tenant). */
  state?: Record<string, unknown>;
  stateError?: { code: string; message: string };
}

/** Deterministic pseudo-random order, so a "shuffled" run is reproducible. */
function reorder<T>(items: T[], order: Order): T[] {
  if (order === "forward") return [...items];
  if (order === "reverse") return [...items].reverse();
  let seed = 12345;
  const keyed = items.map((item) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return { item, key: seed };
  });
  return keyed.sort((a, b) => a.key - b.key).map((k) => k.item);
}

function makeFakes(options: Options = {}) {
  const order = options.order ?? "forward";
  const calls: Call[] = [];
  let counter = 0;
  const newId = () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
  const secrets = new Set<string>();
  let secretCounter = 0;
  const newSecret = (prefix: string) => {
    secretCounter += 1;
    const value = `${prefix}-FAKE-SECRET-${secretCounter}`;
    secrets.add(value);
    return value;
  };

  // The world the fakes keep, so later answers depend on earlier calls (and are listed in odd orders).
  const world = {
    ingredients: [] as { id: string; row: Record<string, unknown> }[],
    suppliers: [] as { id: string; row: Record<string, unknown> }[],
    staged: new Map<string, { supplierVat: string; lines: Record<string, unknown>[] }>(),
    lineIds: new Map<string, { id: string; code: string; ingredient: string | null }[]>(),
    items: new Map<
      string,
      { id: string; code: string; ingredient: string; preferred: boolean }[]
    >(),
    devices: [] as { id: string; label: string }[],
    authUsers: [] as { id: string; email: string }[],
    passwordsSet: new Map<string, string[]>(),
    createdWith: new Map<string, string>(),
    batchIds: [] as string[],
    deletedAuth: [] as string[],
    signedOut: [] as string[],
    purged: [] as string[],
    cleanups: 0,
    pendingEmail: new Map<string, string>(),
    enrolLabels: new Map<string, string>(),
    recipes: new Map<string, string>(),
  };

  function makeDb(role: ClientRole): DemoDb {
    const record = (kind: Call["kind"], name: string, args: Record<string, unknown>) =>
      calls.push({ client: role, kind, name, args });
    return {
      role,
      async rpc(name, args = {}) {
        record("rpc", name, args);
        const custom = options.override?.[name];
        if (custom) return custom(args) as never;
        return answer(name, args) as never;
      },
      async insert(table, row) {
        record("insert", table, row);
        const id = newId();
        if (table === "ingredient") world.ingredients.push({ id, row });
        if (table === "supplier") world.suppliers.push({ id, row });
        return ok({ id }) as never;
      },
      async select(table, columns, match = {}) {
        record("select", table, { columns, ...match });
        return selectFrom(table, match) as never;
      },
      async upload(path) {
        record("upload", path, {});
        return ok({});
      },
    };
  }

  const dbs = { service: makeDb("service"), owner: makeDb("owner"), chef: makeDb("chef") };

  function answer(name: string, a: Record<string, unknown>): DbResult {
    switch (name) {
      case "demo_tenant_state":
        if (options.stateError) return { data: null, error: options.stateError };
        return ok(
          options.state ?? {
            exists: true,
            tenantId: a.p_tenant,
            name: TARGET_NAME,
            demoSince: null,
            hasOperationalData: false,
            demoUsers: 0,
          },
        );
      case "begin_demo_data":
        return ok(a.p_tenant);
      case "create_menu_item":
        return ok({ item: { id: newId() } });
      case "create_dining_table":
        return ok({ table: { id: newId() } });
      case "create_staff":
        return ok({ id: a.p_id });
      case "create_enrolment_code":
        world.enrolLabels.set(String(a.p_code_hash), String(a.p_label));
        return ok({ id: newId() });
      case "redeem_enrolment_code": {
        const label = world.enrolLabels.get(String(a.p_code_hash)) ?? "?";
        world.devices.push({ id: newId(), label });
        return ok({ status: "ok", label });
      }
      case "device_overview":
        return ok({ devices: reorder(world.devices, order), pendingCodes: [] });
      case "demo_stage_invoice": {
        const result = a.p_result as {
          header: { supplier_vat: string };
          lines: Record<string, unknown>[];
        };
        world.staged.set(String(a.p_invoice), {
          supplierVat: result.header.supplier_vat,
          lines: result.lines,
        });
        const supplier = fixture.suppliers.find((s) => s.vat === result.header.supplier_vat)!;
        const known = world.items.get(supplier.key) ?? [];
        world.lineIds.set(
          String(a.p_invoice),
          result.lines.map((line) => {
            const code = String(line.supplier_code);
            const item = known.find((i) => i.code === code);
            return { id: newId(), code, ingredient: item ? item.ingredient : null };
          }),
        );
        return ok("review");
      }
      case "review_update_line": {
        const lines = world.lineIds.get(String(a.p_invoice)) ?? [];
        const line = lines.find((l) => l.id === a.p_line);
        if (!line) return fail("not_found", "P0002");
        const ingredient = String((a.p_patch as { ingredient_id: string }).ingredient_id);
        line.ingredient = ingredient;
        const staged = world.staged.get(String(a.p_invoice))!;
        const supplier = fixture.suppliers.find((s) => s.vat === staged.supplierVat)!;
        const list = world.items.get(supplier.key) ?? [];
        list.push({ id: newId(), code: line.code, ingredient, preferred: false });
        world.items.set(supplier.key, list);
        return ok({});
      }
      case "set_preferred_supplier_item":
        for (const list of world.items.values()) {
          const item = list.find((i) => i.id === a.item_id);
          if (item) item.preferred = true;
        }
        return ok(null);
      case "create_recipe": {
        const key = newId();
        world.recipes.set(key, String((a.p_content as { name: string }).name));
        return ok({ key, version: 1 });
      }
      case "set_staff_meal_rule":
        return ok({ ruleId: newId() });
      case "pin_login_begin":
        return ok({ status: "proceed", attemptId: newId(), authEmail: "staff-x@staff.invalid" });
      case "pin_login_finish":
        return ok({ status: "ok", endsAt: "2026-10-25T00:00:00Z" });
      case "batch_proposal":
        return ok({
          recipe: { id: newId() },
          inputs: reorder(world.ingredients, order).map((ing) => ({
            ingredientId: ing.id,
            proposedQty: 1.5,
            baseUnit: ing.row.base_unit,
            isStock: ing.row.is_stock,
          })),
        });
      case "produce_batch": {
        const batchId = newId();
        world.batchIds.push(batchId);
        return ok({ batchId });
      }
      case "batch_detail":
        return ok({ portionsRemaining: 34 });
      case "count_start":
        return ok({ id: newId() });
      case "demo_tenant_row_counts":
        return ok({ invoice: 5, stock_movement: 33 });
      case "purge_demo_data_by_id":
        return ok({});
      default:
        return ok({});
    }
  }

  function selectFrom(table: string, match: Record<string, string>): DbResult {
    switch (table) {
      case "app_user":
        return ok([{ id: "0000aaaa-0000-4000-8000-00000000000a" }]);
      case "invoice_line": {
        const lines = world.lineIds.get(match.invoice_id ?? "") ?? [];
        return ok(
          reorder(lines, order).map((l) => ({
            id: l.id,
            supplier_code: l.code,
            ingredient_id: l.ingredient,
          })),
        );
      }
      case "supplier_item": {
        const supplier = world.suppliers.find((s) => s.id === match.supplier_id);
        const key = fixture.suppliers.find((s) => s.name === supplier?.row.name)?.key ?? "";
        return ok(
          reorder(world.items.get(key) ?? [], order).map((i) => ({
            id: i.id,
            supplier_code: i.code,
            ingredient_id: i.ingredient,
            is_preferred: i.preferred,
          })),
        );
      }
      case "payable":
        return ok([{ id: `pay-of-${match.invoice_id}` }]);
      case "alert":
        return ok(
          reorder(options.alertKinds ?? fixture.expected.alertKinds, order).map((kind) => ({
            kind,
          })),
        );
      default:
        return fail("unexpected_select");
    }
  }

  const signIn = async (email: string, password: string): Promise<SignedIn> => {
    calls.push({ client: "auth", kind: "auth", name: "signIn", args: { email } });
    expect(secrets.has(password)).toBe(true);
    const isOwner = email === OWNER_EMAIL;
    const authId = world.authUsers.find((u) => u.email === email)?.id ?? "unknown-auth";
    return {
      db: isOwner ? dbs.owner : dbs.chef,
      authId,
      sessionId: isOwner ? null : "55555555-5555-4555-8555-555555555555",
      async end() {
        world.signedOut.push(email);
      },
    };
  };

  const authAdmin: SeedDeps["authAdmin"] = {
    async createUser(attrs) {
      calls.push({
        client: "auth",
        kind: "auth",
        name: "createUser",
        args: { email: attrs.email },
      });
      expect(attrs.email_confirm).toBe(true);
      const id = newId();
      world.authUsers.push({ id, email: attrs.email });
      world.createdWith.set(id, attrs.password);
      return { data: { user: { id } }, error: null };
    },
    async updateUserById(id, attrs) {
      calls.push({ client: "auth", kind: "auth", name: "updateUserById", args: { id } });
      world.passwordsSet.set(id, [...(world.passwordsSet.get(id) ?? []), attrs.password]);
      return { error: null };
    },
    async deleteUser(id) {
      calls.push({ client: "auth", kind: "auth", name: "deleteUser", args: { id } });
      world.deletedAuth.push(id);
      return { error: null };
    },
  };

  const deps: SeedDeps = {
    service: dbs.service,
    authAdmin,
    signIn,
    now: () => new Date("2026-10-24T18:00:00Z"),
    newId,
    newPassword: () => newSecret("PW"),
    newToken: () => newSecret("TOKEN"),
    sha256Hex: (value) => `hash(${value})`.padEnd(64, "0"),
    ownerEmail: OWNER_EMAIL,
    async purge(tenantId, name) {
      calls.push({ client: "run", kind: "run", name: "purge", args: { tenantId, name } });
      world.purged.push(tenantId);
    },
    async cleanup() {
      calls.push({ client: "run", kind: "run", name: "cleanup", args: {} });
      world.cleanups += 1;
    },
  };

  return { deps, calls, world, secrets };
}

const rpcCalls = (calls: Call[], name: string) =>
  calls.filter((c) => c.kind === "rpc" && c.name === name);

describe("errorCode", () => {
  it("takes our own raised names, else the SQLSTATE, else failed", () => {
    expect(errorCode({ code: "P0001", message: "demo_data_exists" })).toBe("demo_data_exists");
    expect(errorCode({ code: "42501", message: "permission denied for table x" })).toBe(
      "sqlstate_42501",
    );
    expect(errorCode({ message: "has spaces and https://x.test/?key=abc" })).toBe("failed");
    expect(errorCode({ code: "weird code!", message: "A B" })).toBe("failed");
    expect(errorCode(null)).toBe("failed");
  });
});

describe.each(["forward", "reverse", "shuffled"] as const)(
  "runSeed (lists come back %s)",
  (order) => {
    it("seeds the whole week and reports counts, logins and alerts", async () => {
      const { deps } = makeFakes({ order });
      const outcome = await seed(deps);
      expect(outcome.error).toBeUndefined();
      expect(outcome.ok).toBe(true);
      expect(outcome.tenantId).toBe(TENANT);
      expect(outcome.counts).toEqual({ invoice: 5, stock_movement: 33 });
      expect(outcome.alerts).toEqual([...fixture.expected.alertKinds].sort());
      expect(outcome.logins.map((l) => `${l.role}:${l.name}`)).toEqual([
        "owner:Titolare (demo)",
        "admin:Supporto DigiAlto (demo)",
        "chef:Chef Bruno (demo)",
        "chef:Cuoca Lia (demo)",
        "waiter:Cameriere Teo (demo)",
        "waiter:Cameriera Ada (demo)",
      ]);
    });

    it("calls every procedure through the role of the plan, and writes no table with the secret key", async () => {
      const { deps, calls } = makeFakes({ order });
      await seed(deps);
      const owner = [
        "create_staff",
        "create_enrolment_code",
        "device_overview",
        "revoke_device",
        "set_supplier_delivery",
        "confirm_ingredient_allergens",
        "update_cost_settings",
        "enter_fixed_costs",
        "review_update_line",
        "set_preferred_supplier_item",
        "approve_invoice",
        "set_payable_status",
        "create_recipe",
        "create_recipe_version",
        "create_menu_item",
        "create_dining_table",
        "set_sale_settings",
        "set_ingredient_rules",
        "set_recipe_rules",
        "set_staff_meal_rule",
      ];
      const chef = [
        "post_transfer",
        "post_waste",
        "consume_raw_fefo",
        "batch_proposal",
        "produce_batch",
        "split_batch",
        "discard_batch",
        "confirm_staff_meal",
        "batch_detail",
        "adjust_batch",
        "set_ingredient_critical",
        "count_start",
        "count_record_lines",
        "count_close",
        "end_my_staff_session",
      ];
      const service = [
        "demo_tenant_state",
        "begin_demo_data",
        "redeem_enrolment_code",
        "demo_stage_invoice",
        "pin_login_begin",
        "pin_login_finish",
        "alert_rules_run",
        "ledger_invariants_run",
        "demo_tenant_row_counts",
      ];
      const expected = new Map<string, ClientRole>([
        ...owner.map((n) => [n, "owner"] as const),
        ...chef.map((n) => [n, "chef"] as const),
        ...service.map((n) => [n, "service"] as const),
      ]);
      const used = new Map<string, Set<ClientRole>>();
      for (const call of calls.filter((c) => c.kind === "rpc")) {
        const set = used.get(call.name) ?? new Set<ClientRole>();
        set.add(call.client as ClientRole);
        used.set(call.name, set);
      }
      // Every procedure used is classified, and was called through exactly its role.
      expect([...used.keys()].sort()).toEqual([...expected.keys()].sort());
      for (const [name, clients] of used) {
        expect({ name, clients: [...clients] }).toEqual({ name, clients: [expected.get(name)] });
      }
      // The secret key makes calls to procedures only: no insert, no select, no upload.
      expect(calls.filter((c) => c.client === "service" && c.kind !== "rpc")).toEqual([]);
      // Table writes are the owner's master data, under RLS.
      expect(
        calls
          .filter((c) => c.kind === "insert")
          .map((c) => `${c.client}:${c.name}`)
          .filter((v, i, all) => all.indexOf(v) === i)
          .sort(),
      ).toEqual(["owner:ingredient", "owner:location", "owner:supplier"]);
      // No recipe table is ever read (the secret key cannot, and the seed has no need to).
      expect(calls.filter((c) => c.kind === "select" && c.name.startsWith("recipe"))).toEqual([]);
      // Only the owner uploads, and only under the tenant.
      const uploads = calls.filter((c) => c.kind === "upload");
      expect(uploads).toHaveLength(5);
      for (const upload of uploads) {
        expect(upload.client).toBe("owner");
        expect(upload.name).toMatch(new RegExp(`^${TENANT}/2026/[0-9a-f-]{36}\\.pdf$`));
      }
    });

    it("uses the ids the database returned, whatever the order of the lists", async () => {
      const { deps, calls, world } = makeFakes({ order });
      await seed(deps);

      // Invoices: the staged id of each fixture invoice is the one approved, and the lines are mapped by supplier code.
      const staged = rpcCalls(calls, "demo_stage_invoice");
      expect(staged).toHaveLength(5);
      const stagedByNumber = new Map(
        staged.map((c) => [
          (c.args.p_result as { header: { number_raw: string } }).header.number_raw,
          String(c.args.p_invoice),
        ]),
      );
      const approvals = rpcCalls(calls, "approve_invoice");
      expect(approvals).toHaveLength(4);
      for (const invoice of fixture.invoices.filter((i) => i.approve)) {
        const call = approvals.find((c) => c.args.p_invoice === stagedByNumber.get(invoice.number));
        expect(call, invoice.key).toBeDefined();
      }
      expect(approvals.map((c) => c.args.p_invoice)).not.toContain(stagedByNumber.get("DEMO-F5"));

      const ingredientIdByName = new Map(world.ingredients.map((i) => [String(i.row.name), i.id]));
      const mappings = rpcCalls(calls, "review_update_line");
      expect(mappings.length).toBeGreaterThan(0);
      for (const call of mappings) {
        const lines = world.lineIds.get(String(call.args.p_invoice))!;
        const line = lines.find((l) => l.id === call.args.p_line)!;
        const fixtureLine = fixture.invoices
          .flatMap((i) => i.lines)
          .find((l) => l.code === line.code)!;
        const ingredient = fixture.ingredients.find((i) => i.key === fixtureLine.ingredient)!;
        expect((call.args.p_patch as { ingredient_id: string }).ingredient_id).toBe(
          ingredientIdByName.get(ingredient.name),
        );
      }
      // The second invoice of a supplier is recognised by automap, so only the first one of each needed mapping.
      const mappedCodes = mappings.map(
        (c) =>
          world.lineIds.get(String(c.args.p_invoice))!.find((l) => l.id === c.args.p_line)!.code,
      );
      expect(new Set(mappedCodes).size).toBe(mappedCodes.length);

      // Payables: the paid one is the payable of the invoice marked paid.
      const paid = rpcCalls(calls, "set_payable_status");
      expect(paid).toHaveLength(1);
      expect(paid[0]!.args).toMatchObject({
        p_payable: `pay-of-${stagedByNumber.get("DEMO-F4")}`,
        p_status: "paid",
        p_paid_on: addDays(TODAY, -1),
      });

      // Devices: only the one labelled as revoked is revoked, found by label, not by position.
      const revoked = rpcCalls(calls, "revoke_device").map((c) => c.args.p_device);
      const sala = world.devices.find((d) => d.label === "Telefono sala (demo)")!;
      expect(revoked).toEqual([sala.id]);

      // One preferred article per mapped article.
      const preferred = rpcCalls(calls, "set_preferred_supplier_item").map((c) => c.args.item_id);
      const allItems = [...world.items.values()].flat();
      expect([...preferred].sort()).toEqual(allItems.map((i) => i.id).sort());
      expect(allItems.every((i) => i.preferred)).toBe(true);
    });

    it("stages each invoice with Rome-relative dates, the owner as creator and its own path", async () => {
      const { deps, calls } = makeFakes({ order });
      await seed(deps);
      const staged = rpcCalls(calls, "demo_stage_invoice");
      for (const call of staged) {
        const result = call.args.p_result as {
          header: { number_raw: string; invoice_date: string; due_date: string };
          lines: { lot_code: string | null; expiry: string | null }[];
        };
        const invoice = fixture.invoices.find((i) => i.number === result.header.number_raw)!;
        expect(result.header.invoice_date).toBe(addDays(TODAY, invoice.dateOffset));
        expect(result.header.due_date).toBe(addDays(TODAY, invoice.dueOffset));
        expect(call.args.p_created_by).toBe("0000aaaa-0000-4000-8000-00000000000a");
        expect(call.args.p_tenant).toBe(TENANT);
        expect(call.args.p_file_path).toBe(
          `${TENANT}/${result.header.invoice_date.slice(0, 4)}/${String(call.args.p_invoice)}.pdf`,
        );
        expect(Number(call.args.p_file_size)).toBeGreaterThan(200);
        for (const line of result.lines.filter((l) => l.lot_code)) {
          const source = invoice.lines.find((l) => l.lotCode === line.lot_code)!;
          expect(line.expiry).toBe(addDays(TODAY, source.expiryOffset!));
        }
      }
      const lots = staged.flatMap((c) =>
        (c.args.p_result as { lines: { lot_code: string | null }[] }).lines
          .map((l) => l.lot_code)
          .filter(Boolean),
      );
      expect(lots.sort()).toEqual(["G-01", "L-01"]);
    });

    it("produces from the proposal: stock ingredients only, each from its home location", async () => {
      const { deps, calls, world } = makeFakes({ order });
      await seed(deps);
      const produced = rpcCalls(calls, "produce_batch");
      expect(produced).toHaveLength(fixture.productions.length);
      const locationByName = new Map(
        calls
          .filter((c) => c.kind === "insert" && c.name === "location")
          .map((c, index) => [String(c.args.name), index]),
      );
      expect(locationByName.size).toBe(2);
      const water = world.ingredients.find((i) => i.row.is_stock === false)!;
      for (const call of produced) {
        const inputs = call.args.p_inputs as {
          ingredientId: string;
          locationId?: string;
          unit: string;
        }[];
        expect(inputs.map((i) => i.ingredientId)).not.toContain(water.id);
        expect(inputs).toHaveLength(world.ingredients.filter((i) => i.row.is_stock).length);
        for (const input of inputs) {
          expect(input.locationId).toBeDefined();
          expect(input.unit).toMatch(/^(kg|l|pz)$/);
        }
      }
      expect(produced.map((c) => c.args.p_output_qty)).toEqual(
        fixture.productions.map((p) => p.outputQty),
      );
    });

    it("splits, discards, eats and adjusts the batches it produced, by id", async () => {
      const { deps, calls, world } = makeFakes({ order });
      await seed(deps);
      // The fakes answer a new batch id per production, in the fixture's order.
      expect(world.batchIds).toHaveLength(fixture.productions.length);
      const idOf = (key: string) =>
        world.batchIds[fixture.productions.findIndex((p) => p.key === key)];
      const split = rpcCalls(calls, "split_batch")[0]!;
      const discard = rpcCalls(calls, "discard_batch")[0]!;
      const adjust = rpcCalls(calls, "adjust_batch")[0]!;
      const detail = rpcCalls(calls, "batch_detail")[0]!;
      expect(split.args).toMatchObject({
        p_batch: idOf(fixture.batchActions.split.from),
        p_portions: fixture.batchActions.split.portions,
        p_hours_from_now: fixture.batchActions.split.hoursFromNow,
      });
      expect(discard.args).toMatchObject({
        p_batch: idOf(fixture.batchActions.discard.from),
        p_portions: fixture.batchActions.discard.portions,
        p_reason: fixture.batchActions.discard.reason,
      });
      expect(split.args.p_batch).not.toBe(discard.args.p_batch);
      expect(detail.args.p_batch).toBe(idOf(fixture.batchActions.adjust.from));
      expect(adjust.args).toMatchObject({
        p_batch: idOf(fixture.batchActions.adjust.from),
        // The detail says 34 portions are left; the chef counts that many minus the fixture's difference.
        p_counted: 34 + fixture.batchActions.adjust.byPortions,
      });
      expect(rpcCalls(calls, "confirm_staff_meal")[0]!.args.p_count).toBe(
        fixture.batchActions.staffMeal.count,
      );
      // The rule it confirms is the one the owner set.
      expect(rpcCalls(calls, "confirm_staff_meal")[0]!.args.p_rule).toBeDefined();
    });

    it("starts the daily count in the cold room and records the counted quantities", async () => {
      const { deps, calls, world } = makeFakes({ order });
      await seed(deps);
      const start = rpcCalls(calls, "count_start")[0]!;
      expect(start.args.p_type).toBe("daily");
      const record = rpcCalls(calls, "count_record_lines")[0]!;
      const close = rpcCalls(calls, "count_close")[0]!;
      expect(record.args.p_session).toBe(close.args.p_session);
      const idByName = new Map(world.ingredients.map((i) => [String(i.row.name), i.id]));
      const lines = record.args.p_lines as { ingredient_id: string; qty: number; unit: string }[];
      expect(lines).toHaveLength(fixture.count.counted.length);
      for (const counted of fixture.count.counted) {
        const name = fixture.ingredients.find((i) => i.key === counted.ingredient)!.name;
        expect(lines.find((l) => l.ingredient_id === idByName.get(name))).toMatchObject({
          qty: counted.qty,
          unit: counted.unit,
        });
      }
      expect(rpcCalls(calls, "set_ingredient_critical").map((c) => c.args.p_critical)).toEqual([
        true,
        true,
      ]);
    });

    it("goes through the PIN gate: begin, sign in, finish with the session id", async () => {
      const { deps, calls } = makeFakes({ order });
      await seed(deps);
      const names = calls
        .filter(
          (c) =>
            c.name === "pin_login_begin" ||
            c.name === "pin_login_finish" ||
            (c.kind === "auth" && c.name === "signIn"),
        )
        .map((c) => c.name);
      expect(names).toEqual(["signIn", "pin_login_begin", "signIn", "pin_login_finish"]);
      const finish = rpcCalls(calls, "pin_login_finish")[0]!;
      expect(finish.args).toMatchObject({
        p_outcome: "success",
        p_auth_session: "55555555-5555-4555-8555-555555555555",
      });
      // The gate sees the hash of the kitchen device's token and the chef's app user id, never a PIN.
      const begin = rpcCalls(calls, "pin_login_begin")[0]!;
      expect(String(begin.args.p_token_hash)).toHaveLength(64);
      expect(Object.keys(begin.args).sort()).toEqual(["p_token_hash", "p_user"]);
    });

    it("ends the sessions and replaces every password with a new random value", async () => {
      const { deps, calls, world, secrets } = makeFakes({ order });
      await seed(deps);
      // Two logins (owner, admin) and four staff.
      expect(world.authUsers).toHaveLength(6);
      expect(world.authUsers.filter((u) => u.email.endsWith("@staff.invalid"))).toHaveLength(4);
      expect(world.authUsers.map((u) => u.email)).toContain(OWNER_EMAIL);
      expect(world.authUsers.map((u) => u.email)).toContain(fixture.admin.email);
      for (const user of world.authUsers) {
        const set = world.passwordsSet.get(user.id) ?? [];
        expect(set).toHaveLength(1);
        expect(secrets.has(set[0]!)).toBe(true);
      }
      // The rotated value is never one the run signed in with.
      const createdWith = new Set(calls.filter((c) => c.name === "createUser").map(() => "x"));
      expect(createdWith.size).toBe(1);
      expect(world.signedOut.sort()).toEqual([OWNER_EMAIL, "staff-x@staff.invalid"].sort());
      expect(rpcCalls(calls, "end_my_staff_session")).toHaveLength(1);
      // The end of the run is the last thing that touches an account, before the counts are read.
      const lastRotation = calls.map((c) => c.name).lastIndexOf("updateUserById");
      const countsRead = calls.map((c) => c.name).lastIndexOf("demo_tenant_row_counts");
      expect(lastRotation).toBeLessThan(countsRead);
    });

    it("prints nothing secret: the outcome and the report hold no password, token or hash, and the owner is masked", async () => {
      const { deps, secrets } = makeFakes({ order });
      const outcome = await seed(deps);
      const line = formatReport(
        buildReport({ target: "local", mode: "seed", ...outcome } as never),
      );
      for (const text of [JSON.stringify(outcome), line]) {
        for (const secret of secrets) expect(text).not.toContain(secret);
        expect(text).not.toContain(OWNER_EMAIL);
        expect(text).not.toMatch(/hash\(/);
      }
      expect(line).toContain("t***@e***.test");
      expect(outcome.logins[0]!.email).toBe("t***@e***.test");
      expect(secrets.size).toBeGreaterThan(10);
    });
  },
);

describe("the target tenant", () => {
  const marked = {
    exists: true,
    tenantId: TENANT,
    name: TARGET_NAME,
    demoSince: "2026-10-20T10:00:00Z",
    hasOperationalData: true,
    demoUsers: 6,
  };

  it("reads the state of the tenant it was given, and nothing else, first", async () => {
    const { deps, calls } = makeFakes();
    await seed(deps);
    expect(calls[0]).toMatchObject({
      client: "service",
      name: "demo_tenant_state",
      args: { p_tenant: TENANT },
    });
    expect(rpcCalls(calls, "begin_demo_data")[0]!.args).toMatchObject({ p_tenant: TENANT });
  });

  it("refuses a tenant that does not exist, before any write", async () => {
    const { deps, calls, world } = makeFakes({ state: { exists: false } });
    const outcome = await seed(deps);
    expect(outcome).toMatchObject({ ok: false, tenantId: null, error: "tenant_not_found" });
    expect(calls.map((c) => c.name)).toEqual(["demo_tenant_state"]);
    expect(world.authUsers).toEqual([]);
  });

  it("refuses an unmarked tenant that holds operational data, before any write", async () => {
    const { deps, calls, world } = makeFakes({
      state: { ...marked, demoSince: null, demoUsers: 0 },
    });
    const outcome = await seed(deps);
    expect(outcome).toMatchObject({
      ok: false,
      tenantId: null,
      error: "tenant_has_operational_data",
    });
    expect(calls.map((c) => c.name)).toEqual(["demo_tenant_state"]);
    expect(world.authUsers).toEqual([]);
    expect(world.purged).toEqual([]);
  });

  it("--reset does not make an unmarked tenant with data purgeable", async () => {
    const { deps, calls, world } = makeFakes({
      state: { ...marked, demoSince: null, demoUsers: 0 },
    });
    const outcome = await seed(deps, { reset: true });
    expect(outcome.error).toBe("tenant_has_operational_data");
    expect(calls.map((c) => c.name)).toEqual(["demo_tenant_state"]);
    expect(world.purged).toEqual([]);
  });

  it("--force skips only the script's own check: the database is asked, and its refusal stops the run with nothing purged", async () => {
    const { deps, calls, world } = makeFakes({
      state: { ...marked, demoSince: null, demoUsers: 0 },
      override: { begin_demo_data: () => fail("tenant_has_operational_data") },
    });
    const outcome = await seed(deps, { force: true });
    expect(outcome).toMatchObject({ ok: false, error: "tenant_has_operational_data" });
    expect(calls.map((c) => c.name)).toContain("begin_demo_data");
    expect(world.purged).toEqual([]);
    expect(world.cleanups).toBe(0);
    // Only the Auth users this run made are removed.
    expect([...world.deletedAuth].sort()).toEqual(world.authUsers.map((u) => u.id).sort());
  });

  it("refuses a marked tenant without --reset, before any write", async () => {
    const { deps, calls, world } = makeFakes({ state: marked });
    const outcome = await seed(deps);
    expect(outcome).toMatchObject({ ok: false, tenantId: null, error: "demo_exists_use_reset" });
    expect(calls.map((c) => c.name)).toEqual(["demo_tenant_state"]);
    expect(world.authUsers).toEqual([]);
    expect(world.purged).toEqual([]);
  });

  it("--force does not replace --reset on a marked tenant", async () => {
    const { deps, world } = makeFakes({ state: marked });
    const outcome = await seed(deps, { force: true });
    expect(outcome.error).toBe("demo_exists_use_reset");
    expect(world.purged).toEqual([]);
  });

  it("--reset on a marked tenant resets it by id with its own name, cleans up, then seeds again", async () => {
    const { deps, calls, world } = makeFakes({ state: marked });
    const outcome = await seed(deps, { reset: true });
    expect(outcome.ok).toBe(true);
    const names = calls.map((c) => c.name);
    expect(names.slice(0, 4)).toEqual(["demo_tenant_state", "purge", "cleanup", "createUser"]);
    expect(names.indexOf("begin_demo_data")).toBeGreaterThan(names.indexOf("cleanup"));
    expect(world.purged).toEqual([TENANT]);
    expect(calls.find((c) => c.name === "purge")!.args).toEqual({
      tenantId: TENANT,
      name: TARGET_NAME,
    });
    expect(world.cleanups).toBe(1);
  });

  it("--reset on a tenant that is not marked and holds nothing just seeds", async () => {
    const { deps, world } = makeFakes();
    await seed(deps, { reset: true });
    expect(world.purged).toEqual([]);
    expect(world.cleanups).toBe(0);
  });

  it("says the migrations are missing when the state function is not there", async () => {
    for (const code of ["42883", "PGRST202"]) {
      const { deps, calls } = makeFakes({ stateError: { code, message: "x" } });
      const outcome = await seed(deps);
      expect(outcome.error).toBe("demo_migrations_missing");
      expect(calls).toHaveLength(1);
    }
  });

  it("creates accounts only on the reserved domains and never reads or changes an existing user", async () => {
    const { deps, calls, world } = makeFakes();
    await seed(deps);
    for (const user of world.authUsers) {
      expect(user.email).toMatch(/(\.demo@example\.test|@staff\.invalid)$/);
    }
    // The only table read for a user is the demo owner's own row, by the Auth id the run just created.
    const reads = calls.filter((c) => c.kind === "select" && c.name === "app_user");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.client).toBe("owner");
    expect(calls.filter((c) => c.kind === "insert" && c.name === "app_user")).toEqual([]);
    expect(world.authUsers.map((u) => u.id).includes(String(reads[0]!.args.auth_id))).toBe(true);
  });

  it("a failure in the kitchen resets THIS run's tenant by id and cleans up", async () => {
    const { deps, calls, world } = makeFakes({
      override: { produce_batch: () => fail("recipe_not_found", "P0002") },
    });
    const outcome = await seed(deps);
    expect(outcome).toMatchObject({ ok: false, error: "recipe_not_found" });
    expect(world.purged).toEqual([TENANT]);
    expect(world.cleanups).toBe(1);
    const names = calls.map((c) => c.name);
    // Nothing after the failed step but the account wrap-up, the reset and the clean-up.
    expect(names).not.toContain("count_start");
    expect(names.indexOf("purge")).toBeGreaterThan(names.indexOf("produce_batch"));
    expect(names.indexOf("cleanup")).toBeGreaterThan(names.indexOf("purge"));
    // The accounts were wrapped up first: sessions ended, passwords rotated.
    expect(rpcCalls(calls, "end_my_staff_session")).toHaveLength(1);
    expect(names.filter((n) => n === "updateUserById")).toHaveLength(6);
  });

  it("a failure at begin (demo_data_exists, from a parallel run) purges nothing and removes only the Auth users it made", async () => {
    const { deps, world } = makeFakes({
      override: { begin_demo_data: () => fail("demo_data_exists") },
    });
    const outcome = await seed(deps);
    expect(outcome).toMatchObject({ ok: false, tenantId: null, error: "demo_data_exists" });
    expect(world.purged).toEqual([]);
    expect(world.cleanups).toBe(0);
    expect(world.authUsers).toHaveLength(2);
    expect([...world.deletedAuth].sort()).toEqual(world.authUsers.map((u) => u.id).sort());
  });
});

describe("menu and tables (M17)", () => {
  it.each(["forward", "reverse", "shuffled"] as const)(
    "creates the menu items on the plates' recipe keys, the tables and the coperto, as the owner (%s)",
    async (order) => {
      const { deps, calls, world } = makeFakes({ order });
      await seed(deps);
      const items = rpcCalls(calls, "create_menu_item");
      expect(items.map((c) => c.client)).toEqual(items.map(() => "owner"));
      expect(items.map((c) => (c.args.p_body as { name: string }).name)).toEqual(
        fixture.menu.map((m) => m.name),
      );
      const recipeKeyByName = new Map([...world.recipes].map(([key, name]) => [name, key]));
      for (const entry of fixture.menu) {
        const body = items.find((c) => (c.args.p_body as { name: string }).name === entry.name)!
          .args.p_body as Record<string, unknown>;
        const plate = entry.recipe ? fixture.recipes.find((r) => r.key === entry.recipe)! : null;
        expect(body).toEqual({
          name: entry.name,
          category: entry.category,
          course: entry.course,
          recipeKey: plate ? recipeKeyByName.get(plate.name) : null,
          price: entry.price,
          vatRate: entry.vatRate,
        });
      }
      const tables = rpcCalls(calls, "create_dining_table");
      expect(tables.map((c) => c.args.p_body)).toEqual(
        fixture.diningTables.map((t, index) => ({ name: t.name, position: index + 1 })),
      );
      expect(rpcCalls(calls, "set_sale_settings").map((c) => c.args.p_patch)).toEqual([
        { copertoAmount: fixture.coperto.amount, copertoVatRate: fixture.coperto.vatRate },
      ]);
      // The menu comes after the recipes it points at.
      const names = calls.map((c) => c.name);
      expect(names.indexOf("create_menu_item")).toBeGreaterThan(
        names.lastIndexOf("create_recipe_version"),
      );
    },
  );

  it("opens no table session and takes no order (M18 is not merged)", async () => {
    const { deps, calls } = makeFakes();
    await seed(deps);
    const names = calls.map((c) => c.name);
    expect(names.filter((n) => /open_table|table_session|order|fire_course/.test(n))).toEqual([]);
  });

  it("a menu failure resets this run's tenant", async () => {
    const { deps, world } = makeFakes({
      override: { create_menu_item: () => fail("recipe_not_plate") },
    });
    const outcome = await seed(deps);
    expect(outcome).toMatchObject({ ok: false, error: "recipe_not_plate" });
    expect(world.purged).toEqual([TENANT]);
  });
});

describe("runSeed failures", () => {
  it("a ledger_drift alert for the demo fails the run and removes it", async () => {
    const { deps, world } = makeFakes({
      alertKinds: [...fixture.expected.alertKinds, "ledger_drift"],
    });
    const outcome = await seed(deps);
    expect(outcome).toMatchObject({ ok: false, error: "ledger_drift" });
    expect(world.purged).toHaveLength(1);
  });

  it("an expected alert that is missing fails the run", async () => {
    const { deps } = makeFakes({ alertKinds: ["prep_due"] });
    const outcome = await seed(deps);
    expect(outcome).toMatchObject({ ok: false, error: "alerts_missing" });
  });

  it.each(["device_revoked", "device_locked", "user_locked"])(
    "a closed PIN gate (%s) stops the kitchen",
    async (status) => {
      const { deps, calls } = makeFakes({
        override: { pin_login_begin: () => ok({ status }) },
      });
      const outcome = await seed(deps);
      expect(outcome).toMatchObject({ ok: false, error: `pin_gate_${status}` });
      expect(calls.map((c) => c.name)).not.toContain("produce_batch");
    },
  );

  it("never repeats a database message: only a short code reaches the outcome", async () => {
    const { deps } = makeFakes({
      override: {
        post_waste: () => ({
          data: null,
          error: { code: "XX000", message: "secret detail: key=FAKE-KEY at https://x.test/?t=1" },
        }),
      },
    });
    const outcome = await seed(deps);
    expect(outcome.error).toBe("sqlstate_xx000");
    expect(JSON.stringify(outcome)).not.toContain("FAKE-KEY");
  });

  it("reports a failed password rotation without hiding the seed", async () => {
    const { deps } = makeFakes();
    deps.authAdmin.updateUserById = async () => ({ error: { status: 500, code: "x" } });
    const outcome: SeedOutcome = await seed(deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("password_rotation_failed");
    expect(outcome.tenantId).not.toBeNull();
  });
});
