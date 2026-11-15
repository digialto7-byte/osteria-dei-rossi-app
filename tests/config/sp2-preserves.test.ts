import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP2 (docs/plans/2026-11-14-sp2-memberships.md §5): the 20261207* migrations are exactly the steps built so far. Each file creates and replaces only the
// objects listed for it, never touches the gate helpers or the PIN login, never cascades, and never mentions the SP0 scratch names. Every later SP2
// migration step adds its file and its objects to STEPS on purpose.
const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const AFTER_MAIN = "20261206100000_order_view_opener_coperto.sql";

type Step = { file: string; tables: string[]; functions: string[] };
const STEPS: Step[] = [
  {
    // S1: organisations and H1.
    file: "20261207100000_organisation.sql",
    tables: ["platform.organisation"],
    functions: ["app.ensure_organisation", "app.tenant_set_organisation"],
  },
];

const FORBIDDEN_DEFINITIONS = [
  "app.tenant_id",
  "app.role",
  "app.app_user_id",
  "app.mfa_needs_aal2",
  "app.staff_session_open",
  "app.pin_sign_in_allowed",
  "public.pin_login_begin",
  "public.pin_login_finish",
];

/** The files of SP2 (timestamp 20261207*), sorted. */
function sp2Migrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("20261207") && f.endsWith(".sql"))
    .sort();
}

/** The SQL without its `--` comments, so a name mentioned in a comment is not a definition. */
function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Qualified names after `create [or replace] <kind>`, lower-cased. */
function created(sql: string, kind: "table" | "function"): string[] {
  const re =
    kind === "table"
      ? /create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_0-9]+)/gi
      : /create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)/gi;
  return [...sql.matchAll(re)].map((m) => m[1]!.toLowerCase());
}

const read = (file: string) => sqlWithoutComments(readFileSync(join(MIGRATIONS, file), "utf8"));

describe("SP2 migrations", () => {
  it("are exactly the steps built so far", () => {
    expect(sp2Migrations(MIGRATIONS)).toEqual(STEPS.map((s) => s.file));
  });

  it("sort after main's newest migration at the time of the branch", () => {
    for (const step of STEPS) expect(step.file.localeCompare(AFTER_MAIN)).toBeGreaterThan(0);
  });

  it("self-test: the listing sees an extra SP2 file and ignores others", () => {
    const dir = mkdtempSync(join(tmpdir(), "sp2-"));
    try {
      writeFileSync(join(dir, STEPS[0]!.file), "");
      writeFileSync(join(dir, "20261207999999_extra.sql"), "");
      writeFileSync(join(dir, AFTER_MAIN), "");
      expect(sp2Migrations(dir)).toEqual([STEPS[0]!.file, "20261207999999_extra.sql"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  for (const step of STEPS) {
    describe(step.file, () => {
      it("creates and replaces only the tables and functions listed for it", () => {
        const sql = read(step.file);
        expect(created(sql, "table")).toEqual(step.tables);
        expect(created(sql, "function")).toEqual(step.functions);
      });

      it("never re-creates the gate helpers or the PIN login", () => {
        const defined = created(read(step.file), "function");
        for (const name of FORBIDDEN_DEFINITIONS) expect(defined).not.toContain(name);
      });

      it("never cascades or deletes", () => {
        const sql = read(step.file);
        expect(sql).not.toMatch(/\bcascade\b/i);
        expect(sql).not.toMatch(/^\s*truncate\s/im);
        expect(sql).not.toMatch(/^\s*delete\s+from\b/im);
      });

      it("never mentions the SP0 scratch names, comments included", () => {
        expect(readFileSync(join(MIGRATIONS, step.file), "utf8")).not.toMatch(
          /sp0_|sp0\.|platform_staff/,
        );
      });
    });
  }

  it("self-test: the comment stripper hides a name in a comment, the extractor sees a real one", () => {
    expect(created(sqlWithoutComments("-- create function app.tenant_id()\n"), "function")).toEqual(
      [],
    );
    expect(created("create or replace function app.role() returns text", "function")).toEqual([
      "app.role",
    ]);
  });
});

describe("the platform schema", () => {
  it("is not exposed through the Data API (supabase/config.toml [api] schemas)", () => {
    const config = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
    const api = /\[api\][\s\S]*?\n(?=\[)/.exec(config)?.[0] ?? "";
    const schemas = /^schemas\s*=\s*\[([^\]]*)\]/m.exec(api)?.[1];
    expect(schemas).toBeDefined();
    expect(schemas).not.toMatch(/platform/);
    expect(schemas).toMatch(/"public"/);
  });
});
