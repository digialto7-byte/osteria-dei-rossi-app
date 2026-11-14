import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P2-7 (XML e-invoice upload, docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 5 "Shared lists changed on purpose", S1 on): the 20261204*
// migrations are exactly the steps built so far. They create only the listed tables, triggers and functions, alter only the listed tables, replace
// only the listed functions and drop only the listed constraints and policies. Each step adds its file and its objects here on purpose.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");

// The files of this feature, in step order.
const XML_MIGRATIONS = [
  "20261204100000_xml_invoice_columns.sql",
  "20261204100100_invoice_storage_xml.sql",
  "20261204100200_invoice_vat_summary.sql",
  "20261204100300_import_xml_invoices.sql",
  "20261204100400_replace_with_xml.sql",
  // Lead decision 2026-11-14 (ADR-044 "Statistics-independent automap"): the article lookup of app.automap_lines, re-pinned in pgTAP 365
  "20261204100500_automap_statistics_independent.sql",
];

// Main's newest migration when the branch was cut: every file of this feature sorts after it (supabase db push refuses otherwise).
const AFTER_MAIN = "20261203100500";

// S3 adds public.invoice_vat_summary (append-only, tenant_id + RLS, in the purge list).
const CREATED_TABLES = ["public.invoice_vat_summary"];
// (S3: public.invoice_vat_summary is altered only to enable row level security)
// (S4: public.audit_event gets its action check replaced, with invoice.imported_xml added)
const ALTERED_TABLES = [
  "public.invoice",
  "public.invoice_line",
  "public.invoice_vat_summary",
  "public.audit_event",
];
// S3 replaces app.demo_purge_tables (the new table joins the ADR-018 list).
// The automap re-pin (20261204100500) replaces app.automap_lines, same signature.
const REPLACED_FUNCTIONS = ["app.demo_purge_tables", "app.automap_lines"];

const NEW_FUNCTIONS = [
  // S1: the guard that keeps the six XML columns immutable
  "app.invoice_xml_guard",
  // S4: the constants, lists, payload helpers and the shape check, then the two public procedures
  "app.xml_max_bodies",
  "app.xml_max_lines",
  "app.xml_document_types",
  "app.xml_notes_allowed",
  "app.xml_natures",
  "app.xml_buyer_state",
  "app.xml_str",
  "app.xml_int",
  "app.xml_amount",
  "app.xml_keys_ok",
  "app.xml_check_payload",
  "public.invoice_xml_precheck",
  "public.import_xml_invoices",
  // S5: the replace tap
  "public.review_replace_with_xml",
];
const NEW_TRIGGERS = [
  "invoice_xml_guard",
  // S3: the append-only guards of the VAT summary table
  "invoice_vat_summary_append_only",
  "invoice_vat_summary_no_truncate",
];

// Dropped objects, by kind and name. S1 widens the two file checks of invoice under the same names; S2 re-creates one policy.
const DROPPED = [
  "constraint invoice_file_path_ck",
  "constraint invoice_file_mime_ck",
  // S2: the Storage insert policy is created again with the two new extensions
  "policy invoices_object_insert",
  // S4: the audit action check is replaced as the union of every earlier action plus invoice.imported_xml
  "constraint audit_event_action_check",
];

/** The files of a directory that belong to this feature (timestamp 20261204*), sorted. */
function xmlMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("20261204") && f.endsWith(".sql"))
    .sort();
}

/** The SQL of a migration without its `--` comments, so a name mentioned in a comment is not a definition. */
function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Names (schema-qualified, lower case) after each `create [or replace] function`, optionally only the `or replace` ones. */
function definedFunctions(sql: string, orReplace: boolean): string[] {
  const re = orReplace
    ? /create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi
    : /create\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi;
  return [...sqlWithoutComments(sql).matchAll(re)].map((m) => m[1]!.toLowerCase());
}

/** The objects dropped, as "<kind> <name>": constraints (also in a comma list), policies, indexes, triggers, tables, functions, views, types. */
function droppedObjects(sql: string): string[] {
  const body = sqlWithoutComments(sql);
  const out = [
    ...body.matchAll(
      /drop\s+(constraint|policy|index|trigger|table|function|view|type)\s+(?:if\s+exists\s+)?([a-z_.0-9]+)/gi,
    ),
  ].map((m) => `${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}`);
  return out;
}

function allSql(): string {
  return xmlMigrations(MIGRATIONS)
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

describe("P2-7 migrations", () => {
  it("are exactly the steps built so far", () => {
    expect(xmlMigrations(MIGRATIONS)).toEqual(XML_MIGRATIONS);
  });

  it("sort after main's newest migration at the time of the branch", () => {
    for (const f of XML_MIGRATIONS) expect(f.localeCompare(AFTER_MAIN)).toBeGreaterThan(0);
  });

  it("self-test: the listing sees an extra feature file and ignores others", () => {
    const dir = mkdtempSync(join(tmpdir(), "p27-"));
    try {
      writeFileSync(join(dir, "20261204100000_xml_invoice_columns.sql"), "");
      writeFileSync(join(dir, "20261204999999_extra.sql"), "");
      writeFileSync(join(dir, "20261203100500_reservation_covers.sql"), "");
      expect(xmlMigrations(dir)).toEqual([
        "20261204100000_xml_invoice_columns.sql",
        "20261204999999_extra.sql",
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("create only the listed tables and alter only the listed ones", () => {
    const sql = sqlWithoutComments(allSql());
    const created = [
      ...sql.matchAll(
        /create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z_.]+)/gi,
      ),
    ].map((m) => m[1]!.toLowerCase());
    expect(created.filter((t) => !CREATED_TABLES.includes(t))).toEqual([]);
    for (const t of CREATED_TABLES) expect(created).toContain(t);
    const altered = [...sql.matchAll(/alter\s+table\s+([a-z_.]+)/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(altered.filter((t) => !ALTERED_TABLES.includes(t))).toEqual([]);
  });

  it("create only the listed triggers, and no view and no type", () => {
    const sql = sqlWithoutComments(allSql());
    const triggers = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+([a-z_0-9]+)/gi)].map(
      (m) => m[1]!.toLowerCase(),
    );
    expect(triggers.filter((t) => !NEW_TRIGGERS.includes(t))).toEqual([]);
    for (const t of NEW_TRIGGERS) expect(triggers).toContain(t);
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?(materialized\s+)?view\b/i);
    expect(sql).not.toMatch(/create\s+type\b/i);
  });

  it("drop only the listed constraints and policies (nothing else, and no data is deleted)", () => {
    const dropped = droppedObjects(allSql());
    expect(dropped.filter((d) => !DROPPED.includes(d))).toEqual([]);
    for (const d of DROPPED) expect(dropped).toContain(d);
    const sql = sqlWithoutComments(allSql());
    expect(sql).not.toMatch(/^\s*truncate\s/im);
    expect(sql).not.toMatch(/^\s*delete\s+from\b/im);
  });

  it("replace only the listed functions and create only the listed new ones", () => {
    const sql = allSql();
    expect(definedFunctions(sql, true).filter((f) => !REPLACED_FUNCTIONS.includes(f))).toEqual([]);
    expect(definedFunctions(sql, false).filter((f) => !NEW_FUNCTIONS.includes(f))).toEqual([]);
    // Every listed function is actually defined (the lists do not drift ahead of the files).
    for (const f of NEW_FUNCTIONS) expect(definedFunctions(sql, false)).toContain(f);
    for (const f of REPLACED_FUNCTIONS) expect(definedFunctions(sql, true)).toContain(f);
  });

  it("self-test: the scans ignore comments and see a definition and a drop", () => {
    const sql =
      "-- create or replace function app.role()\ncreate or replace function app.role() returns void;\nalter table t drop constraint a_ck, drop constraint b_ck;\n-- drop table x";
    expect(definedFunctions(sql, true)).toEqual(["app.role"]);
    expect(definedFunctions("-- create function app.x()\n", false)).toEqual([]);
    expect(droppedObjects(sql)).toEqual(["constraint a_ck", "constraint b_ck"]);
  });
});
