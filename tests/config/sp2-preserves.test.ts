import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP2 (docs/plans/2026-11-26-sp02-memberships.md §5): the 20261207* migrations are exactly the steps built so far. Each file creates and replaces only the
// objects listed for it, never touches the gate helpers or the PIN login, never cascades, and never mentions the SP0 scratch names. Every later SP2
// migration step adds its file and its objects to STEPS on purpose.
const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const AFTER_MAIN = "20261206220700_uscita_close.sql";

type Step = {
  file: string;
  tables: string[];
  functions: string[];
  /** The only tables the step may delete from (S5: the auth-purge job, whose earlier deletes are kept as they were). Default: none. */
  deletesFrom?: string[];
  /** The only `on delete cascade` lines the step may hold, exactly (review of PR 2, lead ruling 2026-11-27). Any other cascade fails. */
  cascades?: string[];
};
const STEPS: Step[] = [
  {
    // S1: organisations and H1.
    file: "20261207100000_organisation.sql",
    tables: ["platform.organisation"],
    functions: ["app.ensure_organisation", "app.tenant_set_organisation"],
  },
  {
    // S3: the key, the PIN single-membership trigger, the member-elsewhere guard, the selection table and the hook (one migration).
    file: "20261207100100_memberships.sql",
    // app.session_tenant is a per-session cache: it goes with its membership, so a demo reset (ADR-018) can delete the demo users (pgTAP 194, 434).
    cascades: [
      "foreign key (tenant_id, auth_id) references public.app_user (tenant_id, auth_id) on delete cascade",
    ],
    tables: ["app.session_tenant"],
    functions: [
      "app.app_user_pin_single_membership",
      "app.auth_member_elsewhere",
      "app.custom_access_token_hook",
    ],
  },
  {
    // S4: the session's choice and the login's own venues.
    file: "20261207100200_select_tenant.sql",
    tables: [],
    functions: ["app.tenant_switch_min_interval", "public.select_tenant", "public.my_memberships"],
  },
  {
    // S5: the auth-purge job removes old selections (the function is re-created with one more delete).
    file: "20261207100300_session_tenant_purge.sql",
    tables: [],
    functions: ["app.purge_auth_data"],
    deletesFrom: [
      "public.auth_attempt",
      "public.staff_session",
      "public.device_enrolment",
      "app.enrol_failure",
      "app.session_tenant",
    ],
  },
];

const FORBIDDEN_DEFINITIONS = [
  "app.tenant_id",
  "app.role",
  "app.app_user_id",
  "app.membership_ungated",
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

      it("never cascades or truncates, and deletes only from the tables listed for it (no ledger)", () => {
        const sql = read(step.file);
        const cascading = sql
          .split("\n")
          .filter((line) => /\bcascade\b/i.test(line))
          .map((line) => line.trim());
        expect(cascading).toEqual(step.cascades ?? []);
        expect(sql).not.toMatch(/^\s*truncate\s/im);
        const deleted = [...sql.matchAll(/^\s*delete\s+from\s+([a-z_]+\.[a-z_0-9]+)/gim)].map((m) =>
          m[1]!.toLowerCase(),
        );
        expect(deleted).toEqual(step.deletesFrom ?? []);
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
