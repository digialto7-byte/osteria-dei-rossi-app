import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Comanda per uscita guards (docs/plans/2026-11-18-comanda-uscite.md section 5, "Rules for every step"). Created by step 3; every later
// migration step adds its file to EXPECTED on purpose. The comanda-per-uscita migrations are the 2026120622* files:
//   - exactly the steps built so far, sorted, after every opening-stock file (2026120621*) and before SP2's first (20261207100000);
//   - each creates or replaces exactly the objects of its step, and only objects of the plan;
//   - they never re-create the objects the plan keeps unchanged (section 3.15 "Must stay unchanged"; pgTAP 424 pins their md5);
//   - no `delete from`, `truncate`, `drop ... cascade` or `disable trigger`; no UPDATE statement except M5's one statement on
//     public.order_line with the `closed_at is null and l.uscita is null` predicate, today's order_line writes of the re-created writers, and
//     M8's verbatim close write of public.table_session inside app.close_session_at;
//   - no uuid literal outside comments, no `cron.schedule`, no new public function or table named like cost|margin|price|service.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const BEFORE = "20261207100000_organisation.sql";

/** The built steps, in order, with the objects each creates or replaces (plan section 3). */
const EXPECTED: Record<string, { functions: string[]; tables: string[]; triggers: string[] }> = {
  // Step 3 (M1): order_line.uscita, uscita_call and its append-only guards, the guard and the purge list re-created, the helpers.
  "20261206220000_uscita_core.sql": {
    functions: [
      "app.order_line_guard",
      "app.demo_purge_tables",
      "app.uscita_default",
      "app.order_uscita",
      "app.held_lines",
      "app.line_held",
    ],
    tables: ["public.uscita_call"],
    triggers: ["uscita_call_append_only", "uscita_call_no_truncate"],
  },
  // Step 4 (M2): order entry with an uscita; the line JSON and the sync payload check.
  "20261206220100_uscita_order_entry.sql": {
    functions: [
      "app.order_line_json",
      "public.add_order_line",
      "public.update_order_line",
      "app.apply_op_check_payload",
    ],
    tables: [],
    triggers: [],
  },
  // Step 5 (M3): one send (fire_course with hold) and the call; the sync kind, payload check and dispatcher.
  "20261206220200_uscita_fire_call.sql": {
    functions: [
      "public.fire_course",
      "public.call_uscita",
      "app.uscita_call_json",
      "app.uscita_lines_json",
      "app.sync_op_kinds",
      "app.apply_op_check_payload",
      "app.apply_op_dispatch",
    ],
    tables: [],
    triggers: [],
  },
  // Step 7 (M4): not_prepared; the reason list and void_line.
  "20261206220300_uscita_void.sql": {
    functions: ["app.order_void_reason_codes", "public.void_line"],
    tables: [],
    triggers: [],
  }, // Step 8 (M5): the open sessions placed in place; the NOT VALID check; default 1 and the column comment (lead ruling M5).
  "20261206220400_uscita_open_sessions.sql": {
    functions: ["app.uscite_backfill_open_sessions"],
    tables: [],
    triggers: [],
  },
  // Step 13 (M6): the kitchen board by uscita; kitchen_event.uscita, the keyed helpers on the new key, the two writes, the remap.
  "20261206220500_uscita_kitchen.sql": {
    functions: [
      "app.line_ticket_at",
      "app.kitchen_ticket_key",
      "app.kitchen_ticket_lock",
      "app.kitchen_ticket_state",
      "app.kitchen_ticket_open_lines",
      "app.kitchen_ticket_rows",
      "public.kitchen_mark_line",
      "public.kitchen_set_ticket",
      "app.uscite_kitchen_remap_open_sessions",
    ],
    tables: [],
    triggers: [],
  },
  // Step 17 (M7): the waiter reads; uscite on the tile and the order, every draft unsent.
  "20261206220600_uscita_tables_order_view.sql": {
    functions: [
      "app.session_uscite",
      "app.session_unsent_lines",
      "public.tables_list",
      "public.order_view",
    ],
    tables: [],
    triggers: [],
  },
  // Step 18 (M8): the close guard.
  "20261206220700_uscita_close.sql": {
    functions: ["app.close_session_at"],
    tables: [],
    triggers: [],
  },
};
const FILES = Object.keys(EXPECTED);

/** Every function the comanda per uscita may create or replace over PR2-PR4 (plan sections 3.3-3.11). */
const PLAN_FUNCTIONS = [
  // M1
  "app.order_line_guard",
  "app.demo_purge_tables",
  "app.uscita_default",
  "app.order_uscita",
  "app.held_lines",
  "app.line_held",
  // M2
  "public.add_order_line",
  "public.update_order_line",
  "app.order_line_json",
  "app.apply_op_check_payload",
  // M3
  "public.fire_course",
  "public.call_uscita",
  "app.uscita_call_json",
  "app.uscita_lines_json",
  "app.sync_op_kinds",
  "app.apply_op_dispatch",
  // M4
  "public.void_line",
  "app.order_void_reason_codes",
  "app.void_waste_reason",
  // M5
  "app.uscite_backfill_open_sessions",
  // M6
  "app.line_ticket_at",
  "app.kitchen_ticket_key",
  "app.kitchen_ticket_lock",
  "app.kitchen_ticket_state",
  "app.kitchen_ticket_open_lines",
  "app.kitchen_ticket_rows",
  "public.kitchen_mark_line",
  "public.kitchen_set_ticket",
  "app.uscite_kitchen_remap_open_sessions",
  // M7
  "app.session_uscite",
  "app.session_unsent_lines",
  "public.tables_list",
  "public.order_view",
  // M8
  "app.close_session_at",
];
/** Never re-created (plan section 3.15 "Must stay unchanged"). */
const KEPT = [
  "app.freeze_line_cost",
  "app.ledger_checks_body",
  "app.session_bill_json",
  "public.apply_op",
  "public.kitchen_tickets",
  "public.remove_order_line",
  "app.session_fired_lines",
  "app.deplete_line_batches",
  "app.post_plate_raw_outflow",
  "app.post_stock_outflow",
  "app.batch_settle_state",
  "app.kpi_sales_lines",
  "app.forecast_portion_lines",
  "public.trace_order_line",
  "app.app_vs_register_json",
  "public.close_table",
];

/** The comanda-per-uscita files (timestamp 2026120622*), sorted. */
function usciteMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("2026120622") && f.endsWith(".sql"))
    .sort();
}

/** The SQL without its `--` comments, so a name mentioned in a comment is not a definition. */
function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

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
/** A DELETE, a TRUNCATE statement or a trigger switched off (a `before truncate` trigger is not one). */
const DESTRUCTIVE = /\bdelete\s+from\b|(?:^|;)\s*truncate\b|\bdisable\s+trigger\b/im;
/** An UPDATE statement (`update <table> [alias] set`); a `before update` trigger or a `for update` lock is not one. */
const UPDATE_STATEMENT = /\bupdate\s+(?:only\s+)?[a-z_.]+(?:\s+(?:as\s+)?[a-z_]+)?\s+set\b/gi;
/** M5's only sanctioned UPDATE (plan section 3.8 step 2). */
const M5_UPDATE =
  /update\s+public\.order_line\s+l\s+set\s+uscita\s*=[\s\S]*?s\.closed_at\s+is\s+null\s+and\s+l\.uscita\s+is\s+null/i;
/**
 * The procedures re-created from their originals that already wrote order_line with an UPDATE on main (the edit, the send, the void). Inside
 * their bodies an UPDATE of public.order_line is today's behaviour, kept verbatim; nothing else may be updated there.
 */
const ORDER_LINE_WRITERS = ["public.update_order_line", "public.fire_course", "public.void_line"];
/** M5's function: its body holds the one sanctioned backfill UPDATE. */
const M5_FUNCTION = "app.uscite_backfill_open_sessions";
/** M8 re-creates the close verbatim: its one UPDATE is today's close write of public.table_session, and nothing else may be updated there. */
const CLOSE_FUNCTION = "app.close_session_at";

/** The function blocks of a migration (`create [or replace] function name ... $$ ... $$`), by name. */
function functionBlocks(sql: string): { name: string; text: string }[] {
  return [
    ...sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)[\s\S]*?\$\$[\s\S]*?\$\$/gi,
    ),
  ].map((m) => ({ name: m[1]!.toLowerCase(), text: m[0] }));
}

/** The UPDATE statements of a migration that the plan does not sanction (an empty list passes). */
function unsanctionedUpdates(sql: string): string[] {
  let rest = sql;
  const bad: string[] = [];
  for (const block of functionBlocks(sql)) {
    const updates = [...block.text.matchAll(UPDATE_STATEMENT)].map((m) => m[0]);
    if (ORDER_LINE_WRITERS.includes(block.name)) {
      bad.push(...updates.filter((u) => !/^update\s+public\.order_line\s+set$/i.test(u)));
      rest = rest.replace(block.text, "");
    } else if (block.name === CLOSE_FUNCTION) {
      if (updates.length !== 1 || !/^update\s+public\.table_session\s+set$/i.test(updates[0]!)) {
        bad.push(...updates, "close shape");
      }
      rest = rest.replace(block.text, "");
    } else if (block.name === M5_FUNCTION) {
      if (updates.length !== 1 || !M5_UPDATE.test(block.text)) bad.push(...updates, "M5 shape");
      rest = rest.replace(block.text, "");
    }
  }
  bad.push(...[...rest.matchAll(UPDATE_STATEMENT)].map((m) => m[0]));
  return bad;
}

const body = (file: string) => sqlWithoutComments(readFileSync(join(MIGRATIONS, file), "utf8"));

describe("comanda per uscita migrations: the file list", () => {
  it("the 2026120622* files are exactly the steps built so far", () => {
    expect(usciteMigrations(MIGRATIONS)).toEqual(FILES);
  });

  it("they sort after every opening-stock file and before SP2's first", () => {
    const opening = readdirSync(MIGRATIONS).filter((f) => f.startsWith("2026120621"));
    expect(opening.length).toBeGreaterThan(0);
    for (const f of FILES) {
      for (const o of opening) expect(f.localeCompare(o)).toBeGreaterThan(0);
      expect(f.localeCompare(BEFORE)).toBeLessThan(0);
    }
  });

  it("self-test: the listing sees a comanda file and ignores opening stock's and SP2's files", () => {
    const dir = mkdtempSync(join(tmpdir(), "uscite-"));
    try {
      writeFileSync(join(dir, FILES[0]!), "");
      writeFileSync(join(dir, "20261206210700_x.sql"), "");
      writeFileSync(join(dir, "20261207100000_z.sql"), "");
      writeFileSync(join(dir, "20261206220100_w.sql"), "");
      expect(usciteMigrations(dir)).toEqual([FILES[0], "20261206220100_w.sql"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("comanda per uscita migrations: what they create", () => {
  for (const file of FILES) {
    it(`${file} creates exactly the objects of its step`, () => {
      const sql = body(file);
      expect(createdFunctions(sql)).toEqual(EXPECTED[file]!.functions);
      expect(createdTables(sql)).toEqual(EXPECTED[file]!.tables);
      expect(createdTriggers(sql)).toEqual(EXPECTED[file]!.triggers);
    });

    it(`${file} touches only functions of the plan and re-creates none of the kept ones`, () => {
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

    it(`${file} never deletes, truncates, drops with cascade or disables a trigger`, () => {
      const sql = body(file);
      expect(sql).not.toMatch(DROP_CASCADE);
      expect(sql).not.toMatch(DESTRUCTIVE);
    });

    it(`${file} has no UPDATE but today's order_line writes of the re-created procedures and M5's one`, () => {
      expect(unsanctionedUpdates(body(file))).toEqual([]);
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
});

describe("comanda per uscita migrations: the scanners", () => {
  it("self-test: the UPDATE scanner finds statements and ignores triggers and locks", () => {
    const find = (s: string) => [...s.matchAll(UPDATE_STATEMENT)].length;
    expect(find("update public.order_line l set uscita = 1")).toBe(1);
    expect(find("update public.x set a = 1; update only y as z set b = 2")).toBe(2);
    expect(find("create trigger t before update or delete on public.x")).toBe(0);
    expect(find("select 1 from public.x for update")).toBe(0);
    expect(find("before insert or update of weight_g, unit_price on public.order_line")).toBe(0);
  });

  it("self-test: an UPDATE is sanctioned only on order_line inside the three writers, and M5's only in its function", () => {
    const fn = (name: string, inner: string) =>
      `create or replace function ${name}() returns void as $$ begin ${inner}; end $$;`;
    expect(
      unsanctionedUpdates(fn("public.update_order_line", "update public.order_line set qty = 1")),
    ).toEqual([]);
    expect(
      unsanctionedUpdates(
        fn("public.update_order_line", "update public.stock_movement set qty = 1"),
      ),
    ).not.toEqual([]);
    expect(
      unsanctionedUpdates(fn("public.add_order_line", "update public.order_line set qty = 1")),
    ).not.toEqual([]);
    expect(unsanctionedUpdates("update public.order_line set qty = 1;")).not.toEqual([]);
    expect(
      unsanctionedUpdates(fn("app.close_session_at", "update public.table_session set total = 1")),
    ).toEqual([]);
    expect(
      unsanctionedUpdates(fn("app.close_session_at", "update public.order_line set qty = 1")),
    ).not.toEqual([]);
    expect(
      unsanctionedUpdates(
        fn(
          "app.close_session_at",
          "update public.table_session set total = 1; update public.table_session set total = 2",
        ),
      ),
    ).not.toEqual([]);
    const m5 =
      "update public.order_line l set uscita = 1 from public.table_session s where s.closed_at is null and l.uscita is null";
    expect(unsanctionedUpdates(fn("app.uscite_backfill_open_sessions", m5))).toEqual([]);
    expect(
      unsanctionedUpdates(
        fn("app.uscite_backfill_open_sessions", `${m5}; update public.order_line set qty = 1`),
      ),
    ).not.toEqual([]);
    expect(unsanctionedUpdates(m5)).not.toEqual([]);
  });

  it("self-test: the destructive rule catches a delete, a truncate and a disabled trigger", () => {
    expect("delete from public.uscita_call").toMatch(DESTRUCTIVE);
    expect("truncate table public.x").toMatch(DESTRUCTIVE);
    expect("alter table public.order_line disable trigger order_line_guard").toMatch(DESTRUCTIVE);
    expect("create trigger x before update or delete on t").not.toMatch(DESTRUCTIVE);
    expect("create trigger x before truncate on t").not.toMatch(DESTRUCTIVE);
  });

  it("self-test: the M5 rule needs the open-session and null predicate", () => {
    expect(
      "update public.order_line l set uscita = 1 from public.table_session s where s.closed_at is null and l.uscita is null",
    ).toMatch(M5_UPDATE);
    expect("update public.order_line l set uscita = 1 where true").not.toMatch(M5_UPDATE);
  });

  it("self-test: the comment stripper hides a name in a comment", () => {
    expect(
      createdFunctions(sqlWithoutComments("-- create function app.role()\nselect 1;")),
    ).toEqual([]);
  });
});
