import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Opening stock guards (docs/plans/2026-11-18-opening-stock.md section 5, "Rules for every step"). Created by step 3; every later migration step
// adds its file to EXPECTED on purpose. The opening-stock migrations are the 20261206210* files:
//   - exactly the steps built so far, sorted, after every 20261206200* file (SP1) and before SP2's first (20261207100000);
//   - they create or replace only the objects of plan section 3, each file exactly the objects of its step;
//   - they never re-create the procedures the plan keeps unchanged (reverse_movement, post_stock_outflow, approve_invoice, kpi_purchases, avt_rows,
//     avt_report, count_close, count_record_lines, freeze_line_cost, stock_movements; pgTAP 416 pins their md5);
//   - no `update`, `delete from` or `truncate` on stock_movement, stock_opening or raw_lot, and no `drop ... cascade`;
//   - no uuid literal outside comments, no `cron.schedule`;
//   - no new public function or table named like cost|margin|price|service (pgTAP 286).
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const AFTER = "20261206200400_tenant_locale_settings.sql";
const BEFORE = "20261207100000_organisation.sql";

/** The built steps, in order, with the objects each creates or replaces (plan section 3). */
const EXPECTED: Record<string, { functions: string[]; tables: string[]; triggers: string[] }> = {
  // Step 3 (M1): the enum value only.
  "20261206210000_stock_movement_opening_type.sql": { functions: [], tables: [], triggers: [] },
  // Step 4 (M2): the shape CHECK stock_movement_opening_ck, no object of its own.
  "20261206210100_stock_movement_opening_shape.sql": { functions: [], tables: [], triggers: [] },
  // Step 5 (M3): the operation and draft tables, the append-only guards of stock_opening, the purge list re-created with both tables.
  "20261206210200_stock_opening_tables.sql": {
    functions: ["app.demo_purge_tables"],
    tables: ["public.stock_opening", "public.opening_draft_line"],
    triggers: ["stock_opening_append_only", "stock_opening_no_truncate"],
  },
  // Step 6 (M4): the helpers, the cut-off and the four draft procedures.
  "20261206210300_stock_opening_draft.sql": {
    functions: [
      "app.require_opening_writer",
      "app.opening_max_lines",
      "app.opening_location_state",
      "app.opening_check_bookable",
      "app.opening_check_date",
      "app.opening_line_values",
      "app.opening_draft_line_json",
      "public.opening_draft",
      "public.opening_draft_put",
      "public.opening_draft_remove",
      "public.opening_draft_clear",
    ],
    tables: [],
    triggers: [],
  },
  // Step 7 (M5): the confirm, the history and the summary.
  "20261206210400_post_opening_stock.sql": {
    functions: [
      "public.post_opening_stock",
      "public.opening_history",
      "public.opening_stock_summary",
    ],
    tables: [],
    triggers: [],
  },
  // Step 9 (M6): the correction by reversal.
  "20261206210500_reverse_opening_stock.sql": {
    functions: ["app.opening_reversal_reasons", "public.reverse_opening_stock"],
    tables: [],
    triggers: [],
  }, // Step 10 (M7): the opening-cost fallback, app.ingredient_unit_costs re-created with the same signature.
  "20261206210600_ingredient_cost_opening_fallback.sql": {
    functions: ["app.ingredient_unit_costs"],
    tables: [],
    triggers: [],
  },
};
const FILES = Object.keys(EXPECTED);

/** Every function the opening-stock work may create or replace over all its steps (plan section 3). */
const PLAN_FUNCTIONS = [
  "app.require_opening_writer",
  "app.opening_max_lines",
  "app.opening_location_state",
  "app.opening_check_bookable",
  "app.opening_check_date",
  "app.opening_line_values",
  "app.opening_reversal_reasons",
  // A read helper of step 6: one draft line as the screen reads it (shared by opening_draft and opening_draft_put).
  "app.opening_draft_line_json",
  "public.opening_draft",
  "public.opening_draft_put",
  "public.opening_draft_remove",
  "public.opening_draft_clear",
  "public.post_opening_stock",
  "public.opening_history",
  "public.opening_stock_summary",
  "public.reverse_opening_stock",
  // Re-created by their own steps: the cost fallback (3.7), the reconciliation (3.8) and the purge list (3.2).
  "app.ingredient_unit_costs",
  "public.stock_reconciliation",
  "app.demo_purge_tables",
];
/** Never re-created by opening stock (plan section 5 rules, and section 1 "Out of scope"). */
const KEPT = [
  "public.reverse_movement",
  "app.post_stock_outflow",
  "public.approve_invoice",
  "app.kpi_purchases",
  "app.avt_rows",
  "public.avt_report",
  "public.count_close",
  "public.count_record_lines",
  "app.freeze_line_cost",
  "public.stock_movements",
];

/** The opening-stock files (timestamp 2026120621*), sorted. */
function openingMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("2026120621") && f.endsWith(".sql"))
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

/** A `drop ... cascade` statement (an `on delete cascade` foreign key is not one). */
const DROP_CASCADE = /\bdrop\b[^;]*\bcascade\b/i;

const body = (file: string) => sqlWithoutComments(readFileSync(join(MIGRATIONS, file), "utf8"));

describe("opening stock migrations: the file list", () => {
  it("the 2026120621* files are exactly the steps built so far", () => {
    expect(openingMigrations(MIGRATIONS)).toEqual(FILES);
  });

  it("they sort after every SP1 file and before SP2's first", () => {
    const sp1 = readdirSync(MIGRATIONS).filter((f) => f.startsWith("20261206200"));
    expect(sp1.length).toBeGreaterThan(0);
    for (const f of FILES) {
      for (const s of sp1) expect(f.localeCompare(s)).toBeGreaterThan(0);
      expect(f.localeCompare(AFTER)).toBeGreaterThan(0);
      expect(f.localeCompare(BEFORE)).toBeLessThan(0);
    }
  });

  it("self-test: the listing sees an opening file and ignores SP1's, the comanda per uscita's and SP2's files", () => {
    const dir = mkdtempSync(join(tmpdir(), "opening-"));
    try {
      writeFileSync(join(dir, FILES[0]!), "");
      writeFileSync(join(dir, "20261206200400_x.sql"), "");
      writeFileSync(join(dir, "20261206220000_y.sql"), "");
      writeFileSync(join(dir, "20261207100000_z.sql"), "");
      writeFileSync(join(dir, "20261206210100_w.sql"), "");
      expect(openingMigrations(dir)).toEqual([FILES[0], "20261206210100_w.sql"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("opening stock migrations: what they create", () => {
  for (const file of FILES) {
    it(`${file} creates exactly the objects of its step`, () => {
      const sql = body(file);
      expect(createdFunctions(sql)).toEqual(EXPECTED[file]!.functions);
      expect(createdTables(sql)).toEqual(EXPECTED[file]!.tables);
      expect(createdTriggers(sql)).toEqual(EXPECTED[file]!.triggers);
    });

    it(`${file} touches only functions of plan section 3 and re-creates none of the kept ones`, () => {
      const sql = body(file);
      for (const name of createdFunctions(sql)) expect(PLAN_FUNCTIONS).toContain(name);
      for (const name of KEPT) {
        expect(sql.toLowerCase(), name).not.toMatch(
          new RegExp(
            `(create\\s+(or\\s+replace\\s+)?|drop\\s+|alter\\s+)function\\s+${name.replace(".", "\\.")}\\b`,
          ),
        );
      }
    });

    it(`${file} never drops with cascade and never updates, deletes from or truncates a ledger or lot table`, () => {
      const sql = body(file);
      expect(sql).not.toMatch(DROP_CASCADE);
      expect(sql).not.toMatch(
        /\b(update|delete\s+from|truncate(\s+table)?)\s+(only\s+)?(public\.)?(stock_movement|stock_opening|raw_lot)\b/i,
      );
    });

    it(`${file} has no uuid literal and no cron.schedule`, () => {
      const sql = body(file);
      expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(sql).not.toMatch(/cron\.schedule/i);
    });

    it(`${file} adds no public function or table named like cost, margin, price or service`, () => {
      const sql = body(file);
      const names = [...createdFunctions(sql), ...createdTables(sql)].filter((n) =>
        n.startsWith("public."),
      );
      for (const n of names) expect(n).not.toMatch(/cost|margin|price|service/);
    });
  }

  it("step 3 is the enum value and nothing else, in its own file", () => {
    const statements = body("20261206210000_stock_movement_opening_type.sql")
      .split(";")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    expect(statements).toEqual(["alter type public.stock_movement_type add value 'opening'"]);
  });
});

describe("opening stock migrations: step 4, the shape CHECK", () => {
  const sql = () => body("20261206210100_stock_movement_opening_shape.sql");

  it("adds one CHECK to stock_movement and nothing else", () => {
    const statements = sql()
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /^alter\s+table\s+public\.stock_movement\s+add\s+constraint\s+stock_movement_opening_ck\s+check\s*\(/i,
    );
  });

  it("compares type::text, as 20261026100100 does, so it never uses the new enum value in the same transaction", () => {
    const check = sql();
    expect(check).toMatch(/type::text\s*=\s*'opening'/);
    expect(check).toMatch(/type::text\s*<>\s*'opening'/);
    expect(check).not.toMatch(/type\s*=\s*'opening'::/);
  });

  it("states the shape of plan 3.1: unlotted, no reason, a stated cost, carico or mirror", () => {
    const check = sql().replace(/\s+/g, " ");
    for (const part of [
      "raw_lot_id is null",
      "reason_code is null",
      "unit_cost is not null and unit_cost >= 0",
      "reverses_id is null and ref_type = 'opening' and qty > 0",
      "reverses_id is not null and ref_type = 'reversal' and qty < 0",
      "coalesce(ref_type, '') <> 'opening'",
    ]) {
      expect(check, part).toContain(part);
    }
  });
});

describe("opening stock migrations: the scanners", () => {
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

  it("self-test: the cascade rule catches a drop ... cascade and lets an on delete cascade foreign key through", () => {
    expect("drop table public.x cascade;").toMatch(DROP_CASCADE);
    expect("drop function app.f(uuid)\n  cascade;").toMatch(DROP_CASCADE);
    expect("create table t (a uuid references u (id) on delete cascade);").not.toMatch(
      DROP_CASCADE,
    );
    expect(
      "alter table t drop constraint c; alter table t add constraint d foreign key (a) references u (id) on delete cascade;",
    ).not.toMatch(DROP_CASCADE);
  });

  it("self-test: the ledger rule catches an update, a delete and a truncate, and lets a draft-table delete through", () => {
    const rule =
      /\b(update|delete\s+from|truncate(\s+table)?)\s+(only\s+)?(public\.)?(stock_movement|stock_opening|raw_lot)\b/i;
    expect("update public.stock_movement set qty = 1").toMatch(rule);
    expect("delete from stock_opening where true").toMatch(rule);
    expect("truncate table public.raw_lot").toMatch(rule);
    expect("delete from public.opening_draft_line where true").not.toMatch(rule);
  });
});
