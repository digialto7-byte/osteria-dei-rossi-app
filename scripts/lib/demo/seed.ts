// Demo data seed (docs/plans/2026-10-24-demo-data.md §0, §3.1.2, §3.4, §3.8): fills an EXISTING tenant (named by id) through the
// REAL procedures, as the right role, so every balance, frozen cost and audit row is the one the app would have written.
// The tenant must hold no operational data (the database checks it too); it is marked as carrying demo data, and fake users
// ("(demo)", on reserved domains) are added next to its own users, which are never read or changed.
//   service role (secret key): begin_demo_data, demo_stage_invoice, the device and PIN gates, alert_rules_run,
//                              ledger_invariants_run, and the purge/status reads. No table is ever written with it.
//   owner (signed in):         master data, invoices, payables, recipes, rules, staff, devices.
//   chef (real PIN gate):      productions, split, discard, adjust, staff meal, waste, transfer, manual use, daily count.
// All I/O is injected (DemoDb, AuthAdmin, signIn, clock, random), so the unit test drives it with fakes. Nothing here prints:
// errors carry a short code, never a message, a password, a PIN, a token or a key. Passwords live in this process's memory only
// and are replaced by random throw-away values at the end.
import type { DemoFixture } from "./fixture";
import { invoiceTotals, lineAmount } from "./fixture";
import { demoInvoicePdf } from "./pdf";
import { addDays } from "./dates";
import { maskEmail } from "./report";

// -- Ports ----------------------------------------------------------------------------------------------------------------------------

export interface DbError {
  code?: string;
  message?: string;
}
export interface DbResult<T = unknown> {
  data: T | null;
  error: DbError | null;
}
export type ClientRole = "service" | "owner" | "chef";

/** One client: the secret-key one (service) or a signed-in user's. `insert` and `select` run under that session (RLS applies). */
export interface DemoDb {
  readonly role: ClientRole;
  rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<DbResult<T>>;
  insert<T = unknown>(table: string, row: Record<string, unknown>): Promise<DbResult<T>>;
  select<T = unknown>(
    table: string,
    columns: string,
    match?: Record<string, string>,
  ): Promise<DbResult<T[]>>;
  /** Uploads to the `invoices` bucket. */
  upload(path: string, bytes: Uint8Array): Promise<DbResult>;
}

export interface AuthError {
  status?: number;
  code?: string;
}
export interface AuthAdmin {
  createUser(attrs: {
    email: string;
    password: string;
    email_confirm: boolean;
  }): Promise<{ data: { user: { id: string } | null }; error: AuthError | null }>;
  updateUserById(id: string, attrs: { password: string }): Promise<{ error: AuthError | null }>;
  deleteUser(id: string): Promise<{ error: AuthError | null }>;
}

export interface SignedIn {
  db: DemoDb;
  authId: string;
  /** The Auth session id from the access token (the PIN gate records it). */
  sessionId: string | null;
  /** Ends every session of this user (global sign-out). */
  end(): Promise<void>;
}

export interface SeedDeps {
  service: DemoDb;
  authAdmin: AuthAdmin;
  signIn(email: string, password: string): Promise<SignedIn>;
  now(): Date;
  newId(): string;
  /** A fresh random secret; never logged. */
  newPassword(): string;
  /** A fresh random token (enrolment code or device token); never logged. */
  newToken(): string;
  sha256Hex(value: string): string;
  /** The demo owner's login: an address on the reserved example.test domain, which can receive no mail. */
  ownerEmail: string;
  /** Resets one marked tenant by id through the service role. Used by --reset and by the failure clean-up. */
  purge(tenantId: string, name: string): Promise<void>;
  /** Removes the Auth users and Storage objects of every pending purge. */
  cleanup(): Promise<void>;
}

// -- Result ---------------------------------------------------------------------------------------------------------------------------

export interface SeedLogin {
  role: string;
  name: string;
  /** Already masked: the full address never leaves the runner. */
  email?: string;
}
export interface SeedOutcome {
  ok: boolean;
  tenantId: string | null;
  counts: Record<string, number>;
  logins: SeedLogin[];
  alerts: string[];
  /** A short code when ok is false. */
  error?: string;
}

/** Every id the run creates, by the key of the fixture row and by the id the database returned. */
export interface DemoIds {
  tenantId: string;
  ownerUserId: string;
  staff: Record<string, string>;
  devices: Record<string, string>;
  locations: Record<string, string>;
  suppliers: Record<string, string>;
  ingredients: Record<string, string>;
  /** `${supplierKey}:${code}` -> supplier_item id. */
  supplierItems: Record<string, string>;
  invoices: Record<string, string>;
  payables: Record<string, string>;
  /** Recipe key (the stable id of a recipe across versions). */
  recipes: Record<string, string>;
  menuItems: Record<string, string>;
  tables: Record<string, string>;
  batches: Record<string, string>;
  staffMealRule: string | null;
  countSession: string | null;
}

export class SeedError extends Error {
  constructor(
    readonly code: string,
    readonly step: string,
  ) {
    super(code);
    this.name = "SeedError";
  }
}

const CODE = /^[a-z0-9_]{1,60}$/;
/** A short code from a database error: our own raised names (`demo_tenant_exists`), else the SQLSTATE, else `failed`. */
export function errorCode(error: DbError | AuthError | null | undefined): string {
  if (!error) return "failed";
  const message = "message" in error ? error.message : undefined;
  if (typeof message === "string" && CODE.test(message)) return message;
  if (typeof error.code === "string" && CODE.test(error.code.toLowerCase())) {
    return `sqlstate_${error.code.toLowerCase()}`;
  }
  return "failed";
}

function must<T>(result: DbResult<T>, step: string): T {
  if (result.error) throw new SeedError(errorCode(result.error), step);
  if (result.data === null || result.data === undefined) throw new SeedError("no_data", step);
  return result.data;
}
function mustVoid(result: DbResult, step: string): void {
  if (result.error) throw new SeedError(errorCode(result.error), step);
}

// -- The run --------------------------------------------------------------------------------------------------------------------------

interface Ctx {
  deps: SeedDeps;
  fixture: DemoFixture;
  ids: DemoIds;
  /** The target tenant: given by the caller, never created here. */
  tenantId: string;
  date: (offset: number) => string;
  owner: SignedIn | null;
  chef: SignedIn | null;
  /** Every Auth user this run created, to rotate or remove. */
  authUsers: { id: string; label: string }[];
  /** Passwords by Auth user id: in memory only. */
  passwords: Map<string, string>;
  /** The SHA-256 of each enrolled device's token, by device key. */
  deviceTokenHashes: Record<string, string>;
  /** Alert kinds found at the end. */
  alertKinds: string[];
  logins: SeedLogin[];
}

type StepName =
  "staff" | "master" | "invoices" | "recipes" | "menu" | "rules" | "kitchen" | "counts" | "alerts";
interface Step {
  name: StepName;
  run(ctx: Ctx): Promise<void>;
}

const ownerDb = (ctx: Ctx): DemoDb => {
  if (!ctx.owner) throw new SeedError("owner_not_signed_in", "internal");
  return ctx.owner.db;
};
const chefDb = (ctx: Ctx): DemoDb => {
  if (!ctx.chef) throw new SeedError("chef_not_signed_in", "internal");
  return ctx.chef.db;
};
const idOf = (map: Record<string, string>, key: string, what: string): string => {
  const id = map[key];
  if (!id) throw new SeedError(`unknown_${what}`, "internal");
  return id;
};

async function createAuthUser(ctx: Ctx, email: string, label: string): Promise<string> {
  const password = ctx.deps.newPassword();
  const made = await ctx.deps.authAdmin.createUser({ email, password, email_confirm: true });
  const id = made.data.user?.id;
  if (id) {
    ctx.authUsers.push({ id, label });
    ctx.passwords.set(id, password);
  }
  if (made.error || !id) throw new SeedError(errorCode(made.error), `auth_${label}`);
  return id;
}

// staff: the Auth users, the marker, the owner session, the PIN accounts, the devices -------------------------------------------------
const staffStep: Step = {
  name: "staff",
  async run(ctx) {
    const { deps, fixture, ids } = ctx;
    const ownerAuth = await createAuthUser(ctx, deps.ownerEmail, "owner");
    const adminAuth = await createAuthUser(ctx, fixture.admin.email, "admin");
    // Marks the tenant (the database refuses one that holds data) and adds the demo owner and admin next to its own users.
    ids.tenantId = must(
      await deps.service.rpc<string>("begin_demo_data", {
        p_tenant: ctx.tenantId,
        p_owner_auth: ownerAuth,
        p_owner_name: fixture.owner.name,
        p_admin_auth: adminAuth,
        p_admin_name: fixture.admin.name,
      }),
      "begin_demo_data",
    );

    ctx.owner = await deps.signIn(deps.ownerEmail, idOfPassword(ctx, ownerAuth));
    const me = must(
      await ctx.owner.db.select<{ id: string }>("app_user", "id", { auth_id: ownerAuth }),
      "owner_profile",
    );
    ids.ownerUserId = me.length === 1 ? me[0]!.id : fail("owner_profile_not_found", "staff");

    // PIN accounts: the Auth user first (the synthetic address names the app user id), then create_staff.
    for (const member of fixture.staff) {
      const userId = deps.newId();
      const authId = await createAuthUser(
        ctx,
        `staff-${userId}@staff.invalid`,
        `staff_${member.key}`,
      );
      const created = must(
        await ownerDb(ctx).rpc<{ id: string }>("create_staff", {
          p_id: userId,
          p_auth_id: authId,
          p_display_name: member.name,
          p_role: member.role,
        }),
        "create_staff",
      );
      ids.staff[member.key] = created.id;
    }

    // Devices: a code from the owner, redeemed with the secret key as the device route does.
    for (const device of fixture.devices) {
      const code = deps.newToken();
      const codeHash = deps.sha256Hex(`code:${code}`);
      const tokenHash = deps.sha256Hex(`device:${deps.newToken()}`);
      mustVoid(
        await ownerDb(ctx).rpc("create_enrolment_code", {
          p_code_hash: codeHash,
          p_label: device.label,
        }),
        "create_enrolment_code",
      );
      const redeemed = must(
        await deps.service.rpc<{ status: string }>("redeem_enrolment_code", {
          p_code_hash: codeHash,
          p_token_hash: tokenHash,
          p_ip_hash: deps.sha256Hex("ip:demo-seed"),
        }),
        "redeem_enrolment_code",
      );
      if (redeemed.status !== "ok") throw new SeedError(`enrol_${redeemed.status}`, "staff");
      ctx.deviceTokenHashes[device.key] = tokenHash;
    }
    // The device ids: read the overview and match by LABEL, never by position.
    const overview = must(
      await ownerDb(ctx).rpc<{ devices: { id: string; label: string }[] }>("device_overview"),
      "device_overview",
    );
    for (const device of fixture.devices) {
      const found = overview.devices.filter((d) => d.label === device.label);
      if (found.length !== 1) throw new SeedError("device_not_found", "staff");
      ids.devices[device.key] = found[0]!.id;
    }
    for (const device of fixture.devices.filter((d) => d.revoke)) {
      mustVoid(
        await ownerDb(ctx).rpc("revoke_device", {
          p_device: idOf(ids.devices, device.key, "device"),
        }),
        "revoke_device",
      );
    }
  },
};

function idOfPassword(ctx: Ctx, authId: string): string {
  const password = ctx.passwords.get(authId);
  if (!password) throw new SeedError("password_missing", "internal");
  return password;
}
function fail(code: string, step: string): never {
  throw new SeedError(code, step);
}

// master: locations, suppliers, ingredients (the supplier items arrive with the first mapping of each invoice) ---------------------------
const masterStep: Step = {
  name: "master",
  async run(ctx) {
    const { fixture, ids } = ctx;
    const owner = ownerDb(ctx);
    for (const location of fixture.locations) {
      const made = must(
        await owner.insert<{ id: string }>("location", { name: location.name }),
        "location",
      );
      ids.locations[location.key] = made.id;
    }
    for (const supplier of fixture.suppliers) {
      const made = must(
        await owner.insert<{ id: string }>("supplier", {
          name: supplier.name,
          vat_number: supplier.vat,
          payment_terms_days: supplier.paymentTermsDays,
        }),
        "supplier",
      );
      ids.suppliers[supplier.key] = made.id;
      mustVoid(
        await owner.rpc("set_supplier_delivery", {
          p_supplier: made.id,
          p_patch: {
            leadTimeDays: supplier.leadTimeDays,
            deliveryWeekdays: supplier.deliveryWeekdays,
            orderCutoffTime: supplier.orderCutoffTime,
          },
        }),
        "set_supplier_delivery",
      );
    }
    for (const ingredient of fixture.ingredients) {
      const made = must(
        await owner.insert<{ id: string }>("ingredient", {
          name: ingredient.name,
          base_unit: ingredient.unit,
          is_stock: ingredient.isStock,
          category: ingredient.category,
        }),
        "ingredient",
      );
      ids.ingredients[ingredient.key] = made.id;
      if (ingredient.isStock) {
        mustVoid(
          await owner.rpc("confirm_ingredient_allergens", {
            p_ingredient: made.id,
            p_allergens: ingredient.allergens,
          }),
          "confirm_allergens",
        );
      }
    }
    mustVoid(
      await owner.rpc("update_cost_settings", { p_patch: fixture.costSettings }),
      "cost_settings",
    );
    mustVoid(
      await owner.rpc("enter_fixed_costs", {
        p_month: fixture.fixedCosts.month,
        p_rent: fixture.fixedCosts.rent,
        p_labour: fixture.fixedCosts.labour,
        p_utilities: fixture.fixedCosts.utilities,
      }),
      "fixed_costs",
    );
  },
};

// invoices: the fake pdf, the staging call, the mapping of the first lines, the approval, the payables -------------------------------------
const invoicesStep: Step = {
  name: "invoices",
  async run(ctx) {
    const { deps, fixture, ids } = ctx;
    const owner = ownerDb(ctx);
    const pdf = demoInvoicePdf();
    for (const invoice of fixture.invoices) {
      const invoiceId = deps.newId();
      const date = ctx.date(invoice.dateOffset);
      const supplier = fixture.suppliers.find((s) => s.key === invoice.supplier);
      if (!supplier) throw new SeedError("unknown_supplier", "invoices");
      const path = `${ids.tenantId}/${date.slice(0, 4)}/${invoiceId}.pdf`;
      mustVoid(await owner.upload(path, pdf), "upload_pdf");
      const totals = invoiceTotals(invoice);
      const result = {
        header: {
          supplier_vat: supplier.vat,
          supplier_name: supplier.name,
          number_raw: invoice.number,
          invoice_date: date,
          due_date: ctx.date(invoice.dueOffset),
          payment_terms: `${supplier.paymentTermsDays} giorni`,
          net_total: totals.net,
          vat_total: totals.vat,
          gross_total: totals.gross,
        },
        lines: invoice.lines.map((line) => ({
          raw_description: line.description,
          supplier_code: line.code,
          qty: line.qty,
          unit_raw: line.unit,
          unit_price: line.unitPrice,
          line_amount: lineAmount(line),
          vat_rate: 10,
          lot_code: line.lotCode ?? null,
          expiry: line.expiryOffset === undefined ? null : ctx.date(line.expiryOffset),
          field_confidence: {},
          checks: [],
          extracted: {
            description: line.description,
            supplier_code: line.code,
            qty: line.qty,
            unit: line.unit,
            unit_price: line.unitPrice,
            line_amount: lineAmount(line),
            vat_rate: 10,
            lot_code: line.lotCode ?? null,
            expiry: line.expiryOffset === undefined ? null : ctx.date(line.expiryOffset),
          },
        })),
        gate_flags: [],
        totals_diff: 0,
        field_confidence: {},
        extraction_json: { demo: true },
      };
      const status = must(
        await deps.service.rpc<string>("demo_stage_invoice", {
          p_tenant: ids.tenantId,
          p_invoice: invoiceId,
          p_file_path: path,
          p_file_size: pdf.length,
          p_created_by: ids.ownerUserId,
          p_result: result,
        }),
        "demo_stage_invoice",
      );
      if (status !== "review") throw new SeedError(`invoice_${status}`, "invoices");
      ids.invoices[invoice.key] = invoiceId;

      // The lines automap did not recognise (the first invoice of a supplier): the owner maps them, which also remembers the
      // article for the next invoice. Lines are matched by their supplier code, never by position.
      const lines = must(
        await owner.select<{
          id: string;
          supplier_code: string | null;
          ingredient_id: string | null;
        }>("invoice_line", "id,supplier_code,ingredient_id", { invoice_id: invoiceId }),
        "invoice_lines",
      );
      for (const line of invoice.lines) {
        const row = lines.find((l) => l.supplier_code === line.code);
        if (!row) throw new SeedError("line_not_found", "invoices");
        const ingredientId = idOf(ids.ingredients, line.ingredient, "ingredient");
        if (row.ingredient_id === ingredientId) continue;
        mustVoid(
          await owner.rpc("review_update_line", {
            p_invoice: invoiceId,
            p_line: row.id,
            p_patch: { ingredient_id: ingredientId },
          }),
          "review_update_line",
        );
      }
    }

    // One preferred article per stock ingredient (read by ingredient and supplier code, not by position).
    for (const supplier of fixture.suppliers) {
      const items = must(
        await owner.select<{
          id: string;
          supplier_code: string | null;
          ingredient_id: string;
          is_preferred: boolean;
        }>("supplier_item", "id,supplier_code,ingredient_id,is_preferred", {
          supplier_id: idOf(ids.suppliers, supplier.key, "supplier"),
        }),
        "supplier_items",
      );
      for (const item of items) {
        if (item.supplier_code)
          ids.supplierItems[`${supplier.key}:${item.supplier_code}`] = item.id;
        if (!item.is_preferred) {
          mustVoid(
            await owner.rpc("set_preferred_supplier_item", { item_id: item.id }),
            "set_preferred",
          );
        }
      }
    }

    const location = (key: string) => idOf(ids.locations, key, "location");
    for (const invoice of fixture.invoices.filter((i) => i.approve)) {
      mustVoid(
        await owner.rpc("approve_invoice", {
          p_invoice: idOf(ids.invoices, invoice.key, "invoice"),
          p_location: location(invoice.location),
        }),
        "approve_invoice",
      );
      const payable = must(
        await owner.select<{ id: string }>("payable", "id", {
          invoice_id: idOf(ids.invoices, invoice.key, "invoice"),
        }),
        "payable",
      );
      if (payable.length !== 1) throw new SeedError("payable_not_found", "invoices");
      ids.payables[invoice.key] = payable[0]!.id;
      if (invoice.paid) {
        mustVoid(
          await owner.rpc("set_payable_status", {
            p_payable: payable[0]!.id,
            p_status: "paid",
            p_paid_on: ctx.date(-1),
            p_reason: null,
            p_reversal: false,
          }),
          "set_payable_status",
        );
      }
    }
  },
};

type RecipeLineBody = { ingredientId?: string; recipeKey?: string; qty: number; unit: string };
function recipeContent(ctx: Ctx, recipeIndex: number, version: number): Record<string, unknown> {
  const recipe = ctx.fixture.recipes[recipeIndex]!;
  const lines: RecipeLineBody[] = recipe.versions[version]!.lines.map((line) =>
    line.ingredient
      ? {
          ingredientId: idOf(ctx.ids.ingredients, line.ingredient, "ingredient"),
          qty: line.qty,
          unit: line.unit,
        }
      : {
          recipeKey: idOf(ctx.ids.recipes, line.recipe!, "recipe"),
          qty: line.qty,
          unit: line.unit,
        },
  );
  return {
    name: recipe.name,
    ...(recipe.outputQty !== undefined
      ? { outputQty: recipe.outputQty, outputUnit: recipe.outputUnit }
      : {}),
    ...(recipe.portionsPerBatch !== undefined ? { portionsPerBatch: recipe.portionsPerBatch } : {}),
    ...(recipe.shelfLifeHours !== undefined ? { shelfLifeHours: recipe.shelfLifeHours } : {}),
    ...(recipe.salePrice !== undefined ? { salePrice: recipe.salePrice } : {}),
    lines,
  };
}

// recipes: in the fixture's order (a sub-recipe before its users), then the later versions ----------------------------------------------
const recipesStep: Step = {
  name: "recipes",
  async run(ctx) {
    const owner = ownerDb(ctx);
    for (const [index, recipe] of ctx.fixture.recipes.entries()) {
      const made = must(
        await owner.rpc<{ key: string; version: number }>("create_recipe", {
          p_type: recipe.type,
          p_content: recipeContent(ctx, index, 0),
        }),
        "create_recipe",
      );
      ctx.ids.recipes[recipe.key] = made.key;
      for (let version = 1; version < recipe.versions.length; version += 1) {
        mustVoid(
          await owner.rpc("create_recipe_version", {
            p_key: made.key,
            p_base_version: version,
            p_content: recipeContent(ctx, index, version),
          }),
          "create_recipe_version",
        );
      }
    }
  },
};

// menu (M17): items on the plates' recipe keys, tables and the coperto, through M17's procedures. No session is opened -------------------
const menuStep: Step = {
  name: "menu",
  async run(ctx) {
    const { fixture, ids } = ctx;
    const owner = ownerDb(ctx);
    for (const entry of fixture.menu) {
      const made = must(
        await owner.rpc<{ item: { id: string } }>("create_menu_item", {
          p_body: {
            name: entry.name,
            category: entry.category,
            course: entry.course,
            recipeKey: entry.recipe ? idOf(ids.recipes, entry.recipe, "recipe") : null,
            price: entry.price,
            vatRate: entry.vatRate,
          },
        }),
        "create_menu_item",
      );
      ids.menuItems[entry.key] = made.item.id;
    }
    for (const [index, table] of fixture.diningTables.entries()) {
      const made = must(
        await owner.rpc<{ table: { id: string } }>("create_dining_table", {
          p_body: { name: table.name, position: index + 1 },
        }),
        "create_dining_table",
      );
      ids.tables[table.key] = made.table.id;
    }
    mustVoid(
      await owner.rpc("set_sale_settings", {
        p_patch: { copertoAmount: fixture.coperto.amount, copertoVatRate: fixture.coperto.vatRate },
      }),
      "set_sale_settings",
    );
  },
};

// rules: reorder levels, prep minimums, the staff meal ---------------------------------------------------------------------------------
const rulesStep: Step = {
  name: "rules",
  async run(ctx) {
    const { fixture, ids } = ctx;
    const owner = ownerDb(ctx);
    for (const rule of fixture.ingredientRules) {
      mustVoid(
        await owner.rpc("set_ingredient_rules", {
          p_ingredient: idOf(ids.ingredients, rule.ingredient, "ingredient"),
          p_patch: { minLevel: rule.minLevel, targetLevel: rule.targetLevel },
        }),
        "set_ingredient_rules",
      );
    }
    for (const recipe of fixture.recipes.filter((r) => r.rules)) {
      mustVoid(
        await owner.rpc("set_recipe_rules", {
          p_recipe_key: idOf(ids.recipes, recipe.key, "recipe"),
          p_patch: {
            minPortions: recipe.rules!.minPortions,
            targetPortions: recipe.rules!.targetPortions,
          },
        }),
        "set_recipe_rules",
      );
    }
    const meal = must(
      await owner.rpc<{ ruleId: string }>("set_staff_meal_rule", {
        p_recipe_key: idOf(ids.recipes, fixture.staffMealRule.recipe, "recipe"),
        p_ingredient_id: null,
        p_default_count: fixture.staffMealRule.defaultCount,
        p_unit: null,
        p_location: null,
        p_is_active: true,
      }),
      "set_staff_meal_rule",
    );
    ids.staffMealRule = meal.ruleId;
  },
};

// kitchen: the chef, through the real PIN gate -----------------------------------------------------------------------------------------
async function signInChef(ctx: Ctx): Promise<SignedIn> {
  const { deps, fixture, ids } = ctx;
  const member = fixture.staff.find((s) => s.role === "chef");
  const device = fixture.devices.find((d) => d.kitchen);
  if (!member || !device) throw new SeedError("no_kitchen_chef", "kitchen");
  const userId = idOf(ids.staff, member.key, "staff");
  const tokenHash = ctx.deviceTokenHashes[device.key];
  if (!tokenHash) throw new SeedError("device_not_enrolled", "kitchen");
  const begin = must(
    await deps.service.rpc<{ status: string; attemptId?: string; authEmail?: string }>(
      "pin_login_begin",
      {
        p_token_hash: tokenHash,
        p_user: userId,
      },
    ),
    "pin_login_begin",
  );
  if (begin.status !== "proceed" || !begin.attemptId || !begin.authEmail) {
    throw new SeedError(`pin_gate_${begin.status}`, "kitchen");
  }
  const authUser = ctx.authUsers.find((u) => u.label === `staff_${member.key}`);
  const password = authUser ? ctx.passwords.get(authUser.id) : undefined;
  if (!password) throw new SeedError("password_missing", "kitchen");
  let signed: SignedIn;
  try {
    signed = await deps.signIn(begin.authEmail, password);
  } catch (error) {
    await deps.service.rpc("pin_login_finish", {
      p_attempt: begin.attemptId,
      p_outcome: "error",
      p_auth_session: null,
    });
    throw error instanceof SeedError ? error : new SeedError("chef_sign_in_failed", "kitchen");
  }
  const finish = must(
    await deps.service.rpc<{ status: string }>("pin_login_finish", {
      p_attempt: begin.attemptId,
      p_outcome: "success",
      p_auth_session: signed.sessionId,
    }),
    "pin_login_finish",
  );
  if (finish.status !== "ok") {
    await signed.end();
    throw new SeedError(`pin_gate_${finish.status}`, "kitchen");
  }
  return signed;
}

const kitchenStep: Step = {
  name: "kitchen",
  async run(ctx) {
    const { fixture, ids } = ctx;
    ctx.chef = await signInChef(ctx);
    const chef = chefDb(ctx);
    const location = (key: string) => idOf(ids.locations, key, "location");
    const ingredient = (key: string) => idOf(ids.ingredients, key, "ingredient");

    for (const t of fixture.stockOps.transfers) {
      mustVoid(
        await chef.rpc("post_transfer", {
          p_ingredient: ingredient(t.ingredient),
          p_qty: t.qty,
          p_unit: t.unit,
          p_from: location(t.from),
          p_to: location(t.to),
          p_lot: null,
        }),
        "post_transfer",
      );
    }
    for (const w of fixture.stockOps.waste) {
      mustVoid(
        await chef.rpc("post_waste", {
          p_ingredient: ingredient(w.ingredient),
          p_qty: w.qty,
          p_unit: w.unit,
          p_reason: w.reason,
          p_location: location(w.location),
          p_lot: null,
        }),
        "post_waste",
      );
    }
    for (const u of fixture.stockOps.manualUse) {
      mustVoid(
        await chef.rpc("consume_raw_fefo", {
          p_ingredient: ingredient(u.ingredient),
          p_qty: u.qty,
          p_unit: u.unit,
          p_location: location(u.location),
          p_lot: null,
        }),
        "consume_raw_fefo",
      );
    }

    // Productions: the proposal expands the recipe into raw inputs; each is taken from the ingredient's home location.
    const homeOf = new Map(fixture.ingredients.map((i) => [i.key, i.home]));
    const keyOfIngredient = new Map(Object.entries(ids.ingredients).map(([key, id]) => [id, key]));
    for (const production of fixture.productions) {
      const recipeKey = idOf(ids.recipes, production.recipe, "recipe");
      const proposal = must(
        await chef.rpc<{
          recipe: { id: string };
          inputs: {
            ingredientId: string;
            proposedQty: number;
            baseUnit: string;
            isStock: boolean;
          }[];
        }>("batch_proposal", {
          p_recipe_key: recipeKey,
          p_output_qty: production.outputQty,
          p_shelf_life_hours: null,
        }),
        "batch_proposal",
      );
      // Only stock ingredients are consumed; water and the like are on the recipe but not in the ledger.
      const inputs = proposal.inputs
        .filter((input) => input.isStock)
        .map((input) => {
          const home = input.isStock
            ? homeOf.get(keyOfIngredient.get(input.ingredientId) ?? "")
            : null;
          return {
            ingredientId: input.ingredientId,
            qty: input.proposedQty,
            unit: input.baseUnit,
            ...(home ? { locationId: location(home) } : {}),
          };
        });
      const made = must(
        await chef.rpc<{ batchId: string }>("produce_batch", {
          p_recipe_id: proposal.recipe.id,
          p_output_qty: production.outputQty,
          p_inputs: inputs,
          p_portions: null,
          p_shelf_life_hours: null,
          p_location: location(fixture.locations[0]!.key),
        }),
        "produce_batch",
      );
      ids.batches[production.key] = made.batchId;
    }

    const actions = fixture.batchActions;
    const split = actions.split;
    mustVoid(
      await chef.rpc("split_batch", {
        p_batch: idOf(ids.batches, split.from, "batch"),
        p_portions: split.portions,
        p_hours_from_now: split.hoursFromNow,
        p_location: location(split.location),
      }),
      "split_batch",
    );
    mustVoid(
      await chef.rpc("discard_batch", {
        p_batch: idOf(ids.batches, actions.discard.from, "batch"),
        p_portions: actions.discard.portions,
        p_reason: actions.discard.reason,
      }),
      "discard_batch",
    );
    mustVoid(
      await chef.rpc("confirm_staff_meal", {
        p_rule: ids.staffMealRule ?? fail("no_staff_meal_rule", "kitchen"),
        p_count: actions.staffMeal.count,
      }),
      "confirm_staff_meal",
    );
    // "Adjust to N fewer": the batch says how many portions it holds now, the chef counts that minus the difference.
    const detail = must(
      await chef.rpc<{ portionsRemaining: number }>("batch_detail", {
        p_batch: idOf(ids.batches, actions.adjust.from, "batch"),
      }),
      "batch_detail",
    );
    mustVoid(
      await chef.rpc("adjust_batch", {
        p_batch: idOf(ids.batches, actions.adjust.from, "batch"),
        p_counted: detail.portionsRemaining + actions.adjust.byPortions,
      }),
      "adjust_batch",
    );
  },
};

// counts: the critical items and the daily count of the cold room --------------------------------------------------------------------------
const countsStep: Step = {
  name: "counts",
  async run(ctx) {
    const { fixture, ids } = ctx;
    const chef = chefDb(ctx);
    for (const key of fixture.critical) {
      mustVoid(
        await chef.rpc("set_ingredient_critical", {
          p_ingredient: idOf(ids.ingredients, key, "ingredient"),
          p_critical: true,
        }),
        "set_ingredient_critical",
      );
    }
    const started = must(
      await chef.rpc<{ id: string }>("count_start", {
        p_type: fixture.count.type,
        p_location: idOf(ids.locations, fixture.count.location, "location"),
      }),
      "count_start",
    );
    ids.countSession = started.id;
    mustVoid(
      await chef.rpc("count_record_lines", {
        p_session: started.id,
        p_lines: fixture.count.counted.map((line) => ({
          ingredient_id: idOf(ids.ingredients, line.ingredient, "ingredient"),
          qty: line.qty,
          unit: line.unit,
        })),
      }),
      "count_record_lines",
    );
    mustVoid(await chef.rpc("count_close", { p_session: started.id }), "count_close");
  },
};

// alerts: one rules run and the nightly invariant check, then the owner reads what was raised -------------------------------------------------
const alertsStep: Step = {
  name: "alerts",
  async run(ctx) {
    const { deps, fixture } = ctx;
    // The clock is read NOW, not at the start of the run: a recipe is "in force" from the moment it was created.
    const at = deps.now().toISOString();
    mustVoid(await deps.service.rpc("alert_rules_run", { p_at: at }), "alert_rules_run");
    mustVoid(
      await deps.service.rpc("ledger_invariants_run", { p_at: at }),
      "ledger_invariants_run",
    );
    const alerts = must(
      await ownerDb(ctx).select<{ kind: string }>("alert", "kind", {}),
      "read_alerts",
    );
    ctx.alertKinds = [...new Set(alerts.map((a) => a.kind))].sort();
    if (ctx.alertKinds.includes("ledger_drift")) throw new SeedError("ledger_drift", "alerts");
    if (fixture.expected.alertKinds.some((kind) => !ctx.alertKinds.includes(kind))) {
      throw new SeedError("alerts_missing", "alerts");
    }
  },
};

export const SEED_STEPS: readonly Step[] = [
  staffStep,
  masterStep,
  invoicesStep,
  recipesStep,
  menuStep,
  rulesStep,
  kitchenStep,
  countsStep,
  alertsStep,
];

function emptyIds(): DemoIds {
  return {
    tenantId: "",
    ownerUserId: "",
    staff: {},
    devices: {},
    locations: {},
    suppliers: {},
    ingredients: {},
    supplierItems: {},
    invoices: {},
    payables: {},
    recipes: {},
    menuItems: {},
    tables: {},
    batches: {},
    staffMealRule: null,
    countSession: null,
  };
}

/** Ends every session and replaces every password with a random value nobody keeps. */
async function finishAccounts(ctx: Ctx): Promise<string | null> {
  let failure: string | null = null;
  if (ctx.chef) {
    try {
      await ctx.chef.db.rpc("end_my_staff_session");
      await ctx.chef.end();
    } catch {
      failure = "session_end_failed";
    }
  }
  if (ctx.owner) {
    try {
      await ctx.owner.end();
    } catch {
      failure = "session_end_failed";
    }
  }
  for (const user of ctx.authUsers) {
    const rotated = await ctx.deps.authAdmin.updateUserById(user.id, {
      password: ctx.deps.newPassword(),
    });
    if (rotated.error) failure = "password_rotation_failed";
  }
  return failure;
}

async function removeAuthUsers(ctx: Ctx): Promise<void> {
  for (const user of ctx.authUsers) {
    await ctx.deps.authAdmin.deleteUser(user.id).catch(() => undefined);
  }
}

export async function runSeed(
  deps: SeedDeps,
  fixture: DemoFixture,
  options: {
    /** The existing tenant to fill. */
    tenantId: string;
    /** The tenant carries demo data already: reset it first, then seed. */
    reset: boolean;
    /** Skip this script's own "holds operational data" check. The database check stays: it cannot be skipped. */
    force: boolean;
  },
): Promise<SeedOutcome> {
  const outcome = (partial: Partial<SeedOutcome>): SeedOutcome => ({
    ok: false,
    tenantId: null,
    counts: {},
    logins: [],
    alerts: [],
    ...partial,
  });

  // 1. What is in the tenant? A missing function means the migrations are not on this project.
  const state = await deps.service.rpc<{
    exists: boolean;
    name?: string;
    demoSince?: string | null;
    hasOperationalData?: boolean;
  }>("demo_tenant_state", { p_tenant: options.tenantId });
  if (state.error) {
    const missing = state.error.code === "42883" || state.error.code === "PGRST202";
    return outcome({ error: missing ? "demo_migrations_missing" : errorCode(state.error) });
  }
  if (!state.data?.exists) return outcome({ error: "tenant_not_found" });
  const tenantName = state.data.name ?? "";
  if (state.data.demoSince) {
    // Demo data is in it already: only --reset replaces it (it resets ALL the tenant's operational data).
    if (!options.reset) return outcome({ error: "demo_exists_use_reset" });
    try {
      await deps.purge(options.tenantId, tenantName);
      await deps.cleanup();
    } catch (error) {
      return outcome({ error: error instanceof SeedError ? error.code : "reset_failed" });
    }
  } else if (state.data.hasOperationalData && !options.force) {
    // Real data, or leftovers of something else: never mixed with the demo.
    return outcome({ error: "tenant_has_operational_data" });
  }

  const ctx: Ctx = {
    deps,
    fixture,
    ids: emptyIds(),
    tenantId: options.tenantId,
    date: (offset) => addDays(fixture.today, offset),
    owner: null,
    chef: null,
    authUsers: [],
    passwords: new Map(),
    deviceTokenHashes: {},
    alertKinds: [],
    logins: [],
  };

  let failure: SeedError | null = null;
  let marked = false;
  for (const step of SEED_STEPS) {
    try {
      await step.run(ctx);
      if (ctx.ids.tenantId) marked = true;
    } catch (error) {
      failure = error instanceof SeedError ? error : new SeedError("unexpected", step.name);
      // The tenant is marked as soon as begin_demo_data has answered, even if the step failed afterwards.
      if (ctx.ids.tenantId) marked = true;
      break;
    }
  }

  const accountsFailure = await finishAccounts(ctx);

  if (failure) {
    // Reset only what THIS run marked: its own tenant, by id. A failure before the marker (for example the database refusing a
    // tenant that holds data, or a parallel run having marked it first) resets nothing, only the Auth users this run made go.
    if (marked) {
      try {
        await deps.purge(ctx.ids.tenantId, tenantName);
        await deps.cleanup();
      } catch {
        return outcome({ tenantId: ctx.ids.tenantId, error: `${failure.code}_cleanup_failed` });
      }
    } else {
      await removeAuthUsers(ctx);
    }
    return outcome({ error: failure.code });
  }

  const counts = await deps.service.rpc<Record<string, number>>("demo_tenant_row_counts", {
    p_tenant: ctx.ids.tenantId,
  });
  ctx.logins.push(
    { role: "owner", name: fixture.owner.name, email: maskEmail(deps.ownerEmail) },
    { role: "admin", name: fixture.admin.name },
    ...fixture.staff.map((member) => ({ role: member.role, name: member.name })),
  );
  return {
    ok: accountsFailure === null,
    tenantId: ctx.ids.tenantId,
    counts: counts.data ?? {},
    logins: ctx.logins,
    alerts: ctx.alertKinds,
    ...(accountsFailure ? { error: accountsFailure } : {}),
  };
}
