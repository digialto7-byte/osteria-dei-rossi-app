import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runScriptLocal } from "../../integration/helpers/psql-script";

// Static guard for scripts/reports/orphan-invoice-objects.sql (plan G6): the report is pasted into the production SQL
// connector, so it must stay one read-only statement. Behaviour: tests/integration/orphan-invoice-objects.int.ts.
const FILE = new URL("../../../scripts/reports/orphan-invoice-objects.sql", import.meta.url);
const sql = readFileSync(FILE, "utf8");

/**
 * The statement with comments removed and string literals blanked, in ONE left-to-right pass (so a `--` inside a literal or a
 * quote inside a comment cannot hide anything). `leaks` lists literal forms that need an escape rule of their own (E'...').
 */
function scan(text: string): { body: string; leaks: string[] } {
  const leaks: string[] = [];
  const body = text
    .replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (token, offset: number) => {
      if (token.startsWith("'")) {
        if (/(^|[^a-z0-9_])[eu]&?$/i.test(text.slice(Math.max(0, offset - 2), offset))) {
          leaks.push("prefixed string literal");
        }
        return "''";
      }
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return { body, leaks };
}

function code(text: string): string {
  return scan(text).body;
}

const ALLOWED_CALLS = new Set([
  "count",
  "sum",
  "min",
  "max",
  "array_agg",
  "unnest",
  "coalesce",
  "substring",
  "now",
  "exists",
  "any",
  "filter",
]);
// Words that may sit in front of a parenthesis without being a function call.
const SYNTAX_BEFORE_PAREN = new Set([
  "as",
  "and",
  "or",
  "not",
  "from",
  "where",
  "when",
  "then",
  "else",
  "select",
  "by",
  "with",
  "in",
  "on",
  "join",
  "case",
  "is",
]);
const ALLOWED_RELATIONS = new Set(["storage.objects", "public.invoice", "app.demo_purge_log"]);
const SCHEMAS = ["storage", "public", "app", "pg_catalog", "pg_temp", "auth", "extensions", "net"];

const WRITE_WORDS =
  /\b(insert|update|delete|merge|truncate|drop|create|alter|grant|revoke|copy|call|do|execute|set|lock|into|vacuum|comment)\b/g;

/** Returns the reasons the statement is not an allowed read-only report (empty when it is). */
export function violations(text: string): string[] {
  const { body, leaks } = scan(text);
  const found: string[] = [...leaks];
  if (!/^(with|select)\b/.test(body)) found.push("not a SELECT");
  if ((body.match(/;/g) ?? []).length !== 1 || !body.endsWith(";")) {
    found.push("not exactly one statement ending the text");
  }
  // Second layer: write, DDL and session words, whole words, wherever they are.
  for (const [word] of body.matchAll(WRITE_WORDS)) found.push(`keyword ${word}`);
  // Syntax that can hide text from this scanner: none of it is used by the real file.
  if (/["$\\]|\/\*|--/.test(body)) found.push("quote, dollar, backslash or comment mark");
  for (const [, name] of body.matchAll(/([a-z_][a-z0-9_.]*)\s*\(/g)) {
    if (!ALLOWED_CALLS.has(name!) && !SYNTAX_BEFORE_PAREN.has(name!)) found.push(`call ${name}`);
  }
  // Relations: every from/join target is an allowed table, a CTE defined here, or a subquery.
  const ctes = new Set([...body.matchAll(/\b([a-z_][a-z0-9_]*)\s+as\s*\(/g)].map((m) => m[1]!));
  for (const [, target] of body.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*|\(|'')/g)) {
    if (target === "(" || target === "''") continue;
    if (!ALLOWED_RELATIONS.has(target!) && !ctes.has(target!)) found.push(`relation ${target}`);
  }
  if (/\b(?:from|join)\s+[a-z_][a-z0-9_.]*(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s*,/.test(body)) {
    found.push("comma join");
  }
  for (const [, qualified] of body.matchAll(
    new RegExp(`\\b((?:${SCHEMAS.join("|")})\\.[a-z_][a-z0-9_]*)`, "g"),
  )) {
    if (!ALLOWED_RELATIONS.has(qualified!)) found.push(`qualified ${qualified}`);
  }
  if (/\bfor\s+(share|update|no\s+key\s+update|key\s+share)\b/.test(body)) found.push("row lock");
  // Object names: `.name` on any alias only inside the prefix extraction or an equality / any() condition; no bare name, no star.
  const rest = body
    .replace(/substring\s*\(\s*[a-z_][a-z0-9_]*\.name\s+from\s+''\s*\)/g, "")
    .replace(/=\s*[a-z_][a-z0-9_]*\.name\b/g, "")
    .replace(/\b[a-z_][a-z0-9_]*\.name\s*=\s*any\s*\(/g, "(")
    .replace(/count\s*\(\s*\*\s*\)/g, "");
  if (/\.name\b/.test(rest)) found.push("a .name column outside the prefix extraction");
  if (/(^|[^.a-z0-9_])name\b/.test(rest)) found.push("bare name column");
  if (/\*/.test(rest)) found.push("star select");
  return found;
}

describe("orphan invoice objects report (read-only SQL)", () => {
  it("has the header: read-only, two-step run with the pre-check, the columns, deletion waits", () => {
    expect(sql).toMatch(/READ-ONLY/);
    expect(sql).toContain("SQL connector");
    expect(sql).toContain("psql");
    expect(sql).toContain("select rolbypassrls from pg_roles where rolname = current_user;");
    expect(sql).toMatch(/1\. Pre-check[\s\S]*must return true[\s\S]*2\. Run the report/);
    expect(sql).toContain(
      "If orphan_count equals bucket_objects, check the role sees every invoice row first",
    );
    expect(sql).toContain("file_path is NOT the only reference");
    expect(sql).toContain("50 OLDEST");
    for (const column of [
      "orphan_count",
      "demo_cleanup_pending",
      "bucket_objects",
      "total_bytes",
      "oldest_created",
      "newest_created",
      "id_prefixes",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toMatch(/after go-live, by script, with the founder's OK/);
  });

  it("the real file passes the allowlist guard", () => {
    expect(violations(sql)).toEqual([]);
  });

  it("keeps the pre-check out of the statement (the file stays one SELECT)", () => {
    expect(code(sql)).not.toContain("pg_roles");
  });

  it("holds the grace window as a marked literal and no secret", () => {
    expect(sql).toMatch(/interval '1 hour'\s+as grace_window\s+-- GRACE WINDOW/);
    expect(sql).not.toMatch(/eyJ|sb_secret|service_role|password/i);
  });

  it.each([
    ["select lo_unlink(16400)"],
    ["select pg_sleep(600)"],
    ["select 1 from storage.objects for share"],
    ["select * from dblink('h','q')"],
    ["select pg_terminate_backend(1)"],
    ["select setval('s',1)"],
    ["select public.purge_demo_data(null)"],
    ["select array_agg(o.name) from storage.objects o"],
    ["select 1 into t"],
    ["with d as (delete from public.invoice returning 1) select count(*) from d"],
    [
      "with d as (update public.invoice set status = 'rejected' returning 1) select count(*) from d",
    ],
    ['select "pg_sleep"(600)'],
    ['select "pg_catalog"."pg_sleep"(600)'],
    ["select '--', pg_sleep(600)\n"],
    ["select '--' ; delete from public.invoice"],
    ["select 1 /* ' */, pg_sleep(600), /* ' */ 2"],
    ["select $$'$$, pg_sleep(600), $$'$$"],
    ["select E'\\'', pg_sleep(600), ''"],
    ["select array_agg(x.name) from storage.objects x"],
    ["select count(*) from pg_stat_activity"],
    ["select count(*) from storage.objects o, pg_stat_activity"],
    ["select name from storage.objects"],
    ["select * from storage.objects"],
    ["select o.* from storage.objects o"],
    ["select 1; select 2"],
    ["select 1 from auth.users"],
    ["delete from public.invoice"],
  ])("the guard rejects %s", (statement) => {
    expect(violations(`${statement};`)).not.toEqual([]);
  });

  it("the guard still accepts a plain allowed select", () => {
    expect(
      violations("select count(*) from storage.objects o where now() > o.created_at;"),
    ).toEqual([]);
  });
});

describe("runScriptLocal (the integration test's runner)", () => {
  it("throws for a remote-looking URL without spawning psql", () => {
    const run = vi.fn(() => "");
    for (const url of [
      "postgresql://postgres:x@db.example.com:5432/postgres",
      "postgresql://postgres:x@127.0.0.1:5432/postgres?host=db.example.com",
    ]) {
      expect(() => runScriptLocal("select 1;", url, run)).toThrow(/local|URL/i);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("runs psql for a local URL and parses header and row", () => {
    const run = vi.fn(() => "a\tb\n1\t2\n");
    expect(runScriptLocal("select 1;", "postgresql://u:p@localhost:5432/d", run)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
