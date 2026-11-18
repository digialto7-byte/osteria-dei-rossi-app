import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP1 guards (docs/plans/2026-11-15-sp01-tenant-config.md section 5, "Rules for all steps"). Created by SP1 step 3; every later migration step
// adds its file to FILES and its objects to EXPECTED on purpose. The SP1 migrations are the 20261206200* files:
//   - exactly the steps built so far, sorting between main's newest (20261206100100) and SP2's first (20261207100000);
//   - they create or replace only the objects of plan 3.2, and each file exactly the objects of its step;
//   - they never re-create the helpers and procedures the plan keeps (app.tenant_id, app.role, app.app_user_id, the access-token hook,
//     app.allowed_vat_rates, app.line_checks, app.menu_vat, create_menu_item, update_menu_item, set_sale_settings);
//   - never `drop ... cascade`, never `delete from`;
//   - no new public name matches cost|margin|price|service (pgTAP 286).
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const AFTER = "20261206100100_device_enrolment_code_hash_comment.sql";
const BEFORE = "20261207100000_organisation.sql";

/** The built steps, in order, with the objects each creates or replaces (plan 3.2). */
const EXPECTED: Record<string, { functions: string[]; tables: string[]; triggers: string[] }> = {
  "20261206200000_tenant_sale_vat.sql": {
    functions: ["app.sale_vat_rates", "app.check_sale_vat_rate", "app.seed_tenant_settings"],
    tables: ["public.tenant_vat_rate"],
    triggers: ["menu_item_price_sale_vat", "sale_settings_sale_vat", "tenant_seed_settings"],
  },
  "20261206200100_sale_vat_reads.sql": {
    functions: ["app.default_vat_rate", "public.menu_items_manage", "public.sale_settings_read"],
    tables: [],
    triggers: [],
  },
};
const FILES = Object.keys(EXPECTED);

/** Every function SP1 may create or replace over all its steps (plan 3.2). */
const PLAN_FUNCTIONS = [
  "app.sale_vat_rates",
  "app.check_sale_vat_rate",
  "app.seed_tenant_settings",
  "app.default_vat_rate",
  "public.menu_items_manage",
  "public.sale_settings_read",
  "app.tenant_receipt_types",
  "app.tenant_payment_types",
  "app.close_session_at",
  "app.app_vs_register_json",
  "public.tenant_settings",
  "public.set_tenant_settings",
];
/** Never re-created by SP1 (plan 5 rules, and 1 "Out of scope"). */
const KEPT = [
  "app.tenant_id",
  "app.role",
  "app.app_user_id",
  "app.custom_access_token_hook",
  "app.allowed_vat_rates",
  "app.line_checks",
  "app.menu_vat",
  "public.create_menu_item",
  "public.update_menu_item",
  "public.set_sale_settings",
];

/** The SP1 files (timestamp 20261206200*), sorted. */
function sp1Migrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("20261206200") && f.endsWith(".sql"))
    .sort();
}

/** The SQL without its `--` comments, so a name mentioned in a comment is not a definition. */
function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Schema-qualified names after `create [or replace] function`, lower-cased, in file order. */
function createdFunctions(sql: string): string[] {
  return [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)/gi)].map(
    (m) => m[1]!.toLowerCase(),
  );
}

function createdTables(sql: string): string[] {
  return [
    ...sql.matchAll(/create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+([a-z_]+\.[a-z_0-9]+)/gi),
  ].map((m) => m[1]!.toLowerCase());
}

function createdTriggers(sql: string): string[] {
  return [...sql.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+([a-z_0-9]+)/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
}

const body = (file: string) => sqlWithoutComments(readFileSync(join(MIGRATIONS, file), "utf8"));

describe("SP1 migrations: the file list", () => {
  it("the 20261206200* files are exactly the steps built so far", () => {
    expect(sp1Migrations(MIGRATIONS)).toEqual(FILES);
  });

  it("they sort after main's newest at the time of the branch and before SP2's first", () => {
    for (const f of FILES) {
      expect(f.localeCompare(AFTER)).toBeGreaterThan(0);
      expect(f.localeCompare(BEFORE)).toBeLessThan(0);
    }
  });

  it("self-test: the listing sees an SP1 file and ignores the DS-BQ-2 hour and SP2's files", () => {
    const dir = mkdtempSync(join(tmpdir(), "sp1-"));
    try {
      writeFileSync(join(dir, FILES[0]!), "");
      writeFileSync(join(dir, "20261206100100_x.sql"), "");
      writeFileSync(join(dir, "20261207100000_y.sql"), "");
      writeFileSync(join(dir, "20261206200100_z.sql"), "");
      expect(sp1Migrations(dir)).toEqual([FILES[0], "20261206200100_z.sql"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("SP1 migrations: what they create", () => {
  for (const file of FILES) {
    it(`${file} creates exactly the objects of its step`, () => {
      const sql = body(file);
      expect(createdFunctions(sql)).toEqual(EXPECTED[file]!.functions);
      expect(createdTables(sql)).toEqual(EXPECTED[file]!.tables);
      expect(createdTriggers(sql)).toEqual(EXPECTED[file]!.triggers);
    });

    it(`${file} touches only functions of plan 3.2 and re-creates none of the kept ones`, () => {
      const sql = body(file);
      for (const name of createdFunctions(sql)) expect(PLAN_FUNCTIONS).toContain(name);
      for (const name of KEPT) {
        expect(sql.toLowerCase(), name).not.toMatch(
          new RegExp(
            `(create\\s+(or\\s+replace\\s+)?|drop\\s+)function\\s+${name.replace(".", "\\.")}\\b`,
          ),
        );
      }
    });

    it(`${file} never drops with cascade and never deletes`, () => {
      const sql = body(file);
      expect(sql).not.toMatch(/\bcascade\b/i);
      expect(sql).not.toMatch(/\bdrop\s+(function|table|trigger|policy|constraint|column)\b/i);
      expect(sql).not.toMatch(/\bdelete\s+from\b/i);
      expect(sql).not.toMatch(/^\s*truncate\s/im);
    });

    it(`${file} adds no public function or table named like cost, margin, price or service`, () => {
      const sql = body(file);
      const names = [...createdFunctions(sql), ...createdTables(sql)].filter((n) =>
        n.startsWith("public."),
      );
      for (const n of names) expect(n).not.toMatch(/cost|margin|price|service/);
    });
  }

  it("the sale VAT migration backfills every existing tenant in one idempotent statement", () => {
    const sql = body("20261206200000_tenant_sale_vat.sql");
    expect(sql).toMatch(
      /insert\s+into\s+public\.tenant_vat_rate\s*\(tenant_id,\s*rate\)\s*select\s+t\.id,\s*r\.rate\s+from\s+public\.tenant\s+t\s+cross\s+join\s+unnest\(app\.allowed_vat_rates\(\)\)[^;]*on\s+conflict\s+do\s+nothing;/i,
    );
  });

  it("the sale VAT migration leaves the table closed: RLS on, select-only policy, no write grant", () => {
    const sql = body("20261206200000_tenant_sale_vat.sql");
    expect(sql).toMatch(
      /alter\s+table\s+public\.tenant_vat_rate\s+enable\s+row\s+level\s+security/i,
    );
    expect(sql.match(/create\s+policy/gi)).toHaveLength(1);
    expect(sql).toMatch(
      /create\s+policy\s+tenant_vat_rate_select\s+on\s+public\.tenant_vat_rate\s+for\s+select\b/i,
    );
    expect(sql).toMatch(
      /revoke\s+insert,\s*update,\s*delete,\s*truncate\s+on\s+public\.tenant_vat_rate\s+from\s+service_role/i,
    );
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|truncate|all)\b/i);
  });
});

describe("SP1 migrations: the scanners", () => {
  it("self-test: the comment stripper hides a name in a comment", () => {
    expect(
      createdFunctions(sqlWithoutComments("-- create function app.role()\nselect 1;")),
    ).toEqual([]);
  });

  it("self-test: the scanners find functions, tables and triggers, with or without or replace", () => {
    const sql =
      "create function app.a() x; create or replace function public.b() y;\ncreate table public.t (a int);\ncreate trigger tg before insert on public.t;";
    expect(createdFunctions(sql)).toEqual(["app.a", "public.b"]);
    expect(createdTables(sql)).toEqual(["public.t"]);
    expect(createdTriggers(sql)).toEqual(["tg"]);
  });
});
