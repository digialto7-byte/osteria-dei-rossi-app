import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PLATFORM_AUDIT_ACTIONS, PLATFORM_NOTICE_KINDS } from "@/lib/platform/codes";
import { describe, expect, it } from "vitest";

// SP3 guards (docs/plans sp3 sections 3.8.3, 3.11 and 5). Created by SP3 step 21; every later SP3 step extends it.
function sourcesUnder(dir: string): string[] {
  const root = new URL(`../../${dir}`, import.meta.url);
  if (!existsSync(root)) return [];
  return (readdirSync(root, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((e) => e.isFile() && /\.(ts|tsx|js|mjs|cjs|jsx)$/.test(e.name))
    .map((e) => `${dir}/${relative(root.pathname, join(e.parentPath, e.name))}`);
}

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("sp3-preserves: the wordmark stays a constant until SP9 (plan 3.8.3)", () => {
  it("VENUE_LAYER_DEFAULT still takes its name from t('venue.name')", () => {
    expect(read("src/lib/design/venue-layer.ts")).toMatch(
      /export const VENUE_LAYER_DEFAULT: Venue = \{ name: t\("venue\.name"\),/,
    );
  });

  it("venue.name is unchanged in it.ts and en.ts", () => {
    expect(read("src/lib/i18n/messages/it.ts")).toContain('"venue.name": "Osteria Dei Rossi",');
    expect(read("src/lib/i18n/messages/en.ts")).toContain('"venue.name": "Osteria Dei Rossi",');
  });

  it("the console band is the constant «Costì · Console» and gives the band no venue (HeaderBand without `venue`) and reads no name", () => {
    const band = read("src/components/console/console-band.tsx");
    expect(band).toContain("Console");
    expect(band).not.toMatch(/venue=|VENUE_LAYER|BrandLink|BrandTitle|BrandWordmark|t\("venue\./);
    expect(band).not.toMatch(/\bprops\b|tenant|venue\.name/i);
  });

  it("no file under src/components/console/** or src/app/(platform)/** hands a tenant name to HeaderBand, BrandLink or VENUE_LAYER_DEFAULT (vacuous while a folder is absent or empty: the count is stated)", () => {
    const found = [
      ...sourcesUnder("src/components/console"),
      ...sourcesUnder("src/app/(platform)"),
    ];
    // Passes with an empty list (folders absent or empty): it then guards nothing yet and says so by the test below.
    for (const file of found)
      expect(read(file), file).not.toMatch(/VENUE_LAYER_DEFAULT|BrandLink|BrandTitle/);
  });

  it("the scan sees the console band today, and finds nothing in a folder that does not exist", () => {
    expect(sourcesUnder("src/components/console")).toContain(
      "src/components/console/console-band.tsx",
    );
    expect(sourcesUnder("src/app/(platform)-absent")).toEqual([]);
  });
});

// The console's pages (SP3 step 18, plan 7a Q2): the signed-in screens sit in the (shell) route group, so the sign-in pages make no /api/platform call.
// Adding or removing a console page is a decision, so the list is pinned.
const CONSOLE_PAGES = [
  "src/app/(platform)/console/(shell)/avvisi/page.tsx",
  "src/app/(platform)/console/(shell)/locali/[id]/page.tsx",
  "src/app/(platform)/console/(shell)/page.tsx",
  "src/app/(platform)/console/(shell)/registro/page.tsx",
  "src/app/(platform)/console/login/attiva-codice/page.tsx",
  "src/app/(platform)/console/login/codice/page.tsx",
  "src/app/(platform)/console/login/page.tsx",
];

describe("sp3-preserves: the console pages (plan 3.1, Q2)", () => {
  it("the pages under src/app/(platform) are exactly the (shell) group and the three sign-in pages", () => {
    const pages = sourcesUnder("src/app/(platform)")
      .filter((file) => /\/page\.tsx$/.test(file))
      .sort();
    expect(pages).toEqual(CONSOLE_PAGES);
  });
});

// Step 6 adds the files of the platform-ops workflow; the migration-list and code-list-equality guards join with the migrations of the stacked steps.
const SP3_FILES = [
  "src/lib/platform/codes.ts",
  "src/lib/platform/api.ts",
  "src/components/console/console-band.tsx",
  ".github/workflows/platform-ops.yml",
  "tests/config/platform-ops-workflow.test.ts",
];

describe("sp3-preserves: naming (plan section 5)", () => {
  it("no SP3 file mentions the spike's sp0_ or sp0. names", () => {
    for (const file of SP3_FILES) expect(read(file), file).not.toMatch(/sp0[_.]/);
  });

  it("no code in the platform code lists is named for cost, margin, price or service", () => {
    for (const code of [...PLATFORM_AUDIT_ACTIONS, ...PLATFORM_NOTICE_KINDS])
      expect(code).not.toMatch(/cost|margin|price|service/);
  });

  it("the platform-ops workflow is the only SP3 file that names the secret key", () => {
    for (const file of SP3_FILES.filter((f) => !f.includes("platform-ops")))
      expect(read(file), file).not.toContain("SUPABASE_SECRET_KEY");
  });
});

// SP3 migrations (plan section 5, "Rules for all steps"): the 20261208* files are exactly the steps built so far and sort after SP2's last file; each creates
// or replaces only the objects listed for it; none re-creates a gate helper or the PIN login, cascades, deletes, or names an object for cost, margin,
// price or service. Every later SP3 migration step adds its file and its objects to STEPS on purpose.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const AFTER_SP2 = "20261207100300_session_tenant_purge.sql";

type Step = { file: string; tables: string[]; functions: string[]; triggers: string[] };
const STEPS: Step[] = [
  {
    // Step 1: the organisation-side VAT guard.
    file: "20261208100000_organisation_vat_guard.sql",
    tables: [],
    functions: ["platform.organisation_vat_locked"],
    triggers: ["organisation_vat_locked"],
  },
  {
    // Step 2: platform.staff and the append-only platform audit.
    file: "20261208100100_platform_staff_audit.sql",
    tables: ["platform.staff", "platform.audit_event"],
    functions: [
      "platform.audit_actions",
      "platform.notice_kinds",
      "platform.audit_detail_keys",
      "platform.audit_detail_ok",
      "platform.audit_event_append_only",
      "platform.audit_write",
    ],
    triggers: ["audit_event_no_update_delete", "audit_event_no_truncate"],
  },
  {
    // Step 3: the staff/member guards.
    file: "20261208100200_platform_staff_guards.sql",
    tables: [],
    functions: ["platform.staff_member_guard", "app.app_user_platform_staff_guard"],
    triggers: ["staff_member_guard", "app_user_platform_staff_guard"],
  },
  {
    // Step 4: the platform admin bootstrap (service role only).
    file: "20261208100300_platform_bootstrap.sql",
    tables: [],
    functions: ["public.platform_bootstrap_admin"],
    triggers: [],
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
  "public.mfa_reset_service_begin",
];

/** The files of SP3 (timestamp 20261208*), sorted. */
function sp3Migrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("20261208") && f.endsWith(".sql"))
    .sort();
}

/** The SQL without its `--` comments, so a name mentioned in a comment is not a definition. */
function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Names after `create [or replace] <kind>`, lower-cased (qualified for tables and functions, bare for triggers). */
function created(sql: string, kind: "table" | "function" | "trigger"): string[] {
  const re = {
    table:
      /create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_0-9]+)/gi,
    function: /create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)/gi,
    trigger: /create\s+(?:or\s+replace\s+)?trigger\s+([a-z_0-9]+)/gi,
  }[kind];
  return [...sql.matchAll(re)].map((m) => m[1]!.toLowerCase());
}

const readSql = (file: string) => sqlWithoutComments(readFileSync(join(MIGRATIONS, file), "utf8"));

describe("SP3 migrations", () => {
  it("are exactly the steps built so far", () => {
    expect(sp3Migrations(MIGRATIONS)).toEqual(STEPS.map((s) => s.file));
  });

  it("sort after SP2's last migration", () => {
    for (const step of STEPS) expect(step.file.localeCompare(AFTER_SP2)).toBeGreaterThan(0);
  });

  it("self-test: the listing sees an extra SP3 file and ignores others", () => {
    const dir = mkdtempSync(join(tmpdir(), "sp3-"));
    try {
      writeFileSync(join(dir, STEPS[0]!.file), "");
      writeFileSync(join(dir, "20261208999999_extra.sql"), "");
      writeFileSync(join(dir, AFTER_SP2), "");
      expect(sp3Migrations(dir)).toEqual([STEPS[0]!.file, "20261208999999_extra.sql"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  for (const step of STEPS) {
    describe(step.file, () => {
      it("creates and replaces only the tables, functions and triggers listed for it", () => {
        const sql = readSql(step.file);
        expect(created(sql, "table")).toEqual(step.tables);
        expect(created(sql, "function")).toEqual(step.functions);
        expect(created(sql, "trigger")).toEqual(step.triggers);
      });

      it("never re-creates the gate helpers or the PIN login", () => {
        const defined = created(readSql(step.file), "function");
        for (const name of FORBIDDEN_DEFINITIONS) expect(defined).not.toContain(name);
      });

      it("never cascades or deletes", () => {
        const sql = readSql(step.file);
        expect(sql).not.toMatch(/\bcascade\b/i);
        expect(sql).not.toMatch(/^\s*truncate\s/im);
        expect(sql).not.toMatch(/^\s*delete\s+from\b/im);
      });

      it("names no object for cost, margin, price or service (naming rule, pgTAP 286)", () => {
        const sql = readSql(step.file);
        const names = [
          ...created(sql, "table"),
          ...created(sql, "function"),
          ...created(sql, "trigger"),
        ];
        for (const name of names) expect(name).not.toMatch(/cost|margin|price|service/);
      });

      it("never mentions the SP0 scratch names sp0_ or sp0., comments included", () => {
        expect(readFileSync(join(MIGRATIONS, step.file), "utf8")).not.toMatch(/sp0[_.]/);
      });
    });
  }

  it("self-test: the comment stripper hides a name in a comment, the extractor sees real ones", () => {
    expect(created(sqlWithoutComments("-- create function app.tenant_id()\n"), "function")).toEqual(
      [],
    );
    expect(created("create or replace function app.role() returns text", "function")).toEqual([
      "app.role",
    ]);
    expect(created("create trigger t_one before update on x.y", "trigger")).toEqual(["t_one"]);
  });
});

// Step 2 (plan 3.1.3, 3.4.2): the registries in SQL equal the client-importable code lists. The text between `array[` and `]` of the function is the list.
/** The quoted strings of the first `array[...]` in the body of `create function <name>` (comments already stripped). */
function sqlArray(sql: string, name: string): string[] {
  const body = new RegExp(
    `create\\s+function\\s+${name.replace(".", "\\.")}\\s*\\(\\)[\\s\\S]*?array\\[([^\\]]*)\\]`,
    "i",
  ).exec(sql)?.[1];
  if (body === undefined) throw new Error(`no array found in ${name}`);
  return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
}

describe("sp3-preserves: the SQL registries equal the code lists (plan 3.1.3)", () => {
  const sql = readSql("20261208100100_platform_staff_audit.sql");

  it("platform.audit_actions() equals PLATFORM_AUDIT_ACTIONS, in order", () => {
    expect(sqlArray(sql, "platform.audit_actions")).toEqual([...PLATFORM_AUDIT_ACTIONS]);
  });

  it("platform.notice_kinds() equals PLATFORM_NOTICE_KINDS, in order", () => {
    expect(sqlArray(sql, "platform.notice_kinds")).toEqual([...PLATFORM_NOTICE_KINDS]);
  });

  it("self-test: the extractor reads a list, ignores later ones and throws when there is none", () => {
    const text =
      "create function platform.x() returns text[] as $$ select array['a', 'b']::text[] $$; create function platform.y() as $$ select array['c'] $$;";
    expect(sqlArray(text, "platform.x")).toEqual(["a", "b"]);
    expect(sqlArray(text, "platform.y")).toEqual(["c"]);
    expect(() => sqlArray(text, "platform.z")).toThrow();
  });
});

// Lead's condition for pgTAP 327's exclusion list (2026-11-15): every public function an SP3 migration creates is left out of 327's catalogue md5 on purpose, so each
// one needs (a) its own line in 327's list naming the SP3 step and "re-pinned on purpose by SP3", and (b) an SP3 pgTAP file that pins existence, SECURITY DEFINER
// (prosecdef), search_path and the exact grants (has_function_privilege) for that name.
const PGTAP_DIR = join(process.cwd(), "supabase/tests/database");

type PgtapFile = { file: string; text: string };

/** Problems with the pin of one public function name; empty when 327 lists it with its comment and an SP3 pgTAP file pins its properties. */
function exclusionProblems(name: string, text327: string, files: PgtapFile[]): string[] {
  const problems: string[] = [];
  const line = text327.split("\n").find((l) => l.includes(`'${name}'`));
  if (line === undefined) problems.push(`${name}: not in 327's exclusion list`);
  else if (!/SP3 step \d+/.test(line) || !/re-pinned on purpose by SP3/.test(line))
    problems.push(`${name}: its 327 line lacks "SP3 step <n>" or "re-pinned on purpose by SP3"`);
  const pinning = files.filter(
    (f) =>
      f.text.includes(name) &&
      /prosecdef/.test(f.text) &&
      /search_path/.test(f.text) &&
      /has_function_privilege/.test(f.text),
  );
  if (pinning.length === 0)
    problems.push(
      `${name}: no SP3 pgTAP file mentions it with prosecdef, search_path and has_function_privilege`,
    );
  return problems;
}

describe("sp3-preserves: pgTAP 327's exclusion list (lead's condition)", () => {
  const text327 = readFileSync(join(PGTAP_DIR, "327_p20b_preserves.test.sql"), "utf8");
  const sp3Files: PgtapFile[] = readdirSync(PGTAP_DIR)
    .filter((f) => /^4[34][0-9]_sp3_.*\.test\.sql$/.test(f))
    .map((file) => ({ file, text: readFileSync(join(PGTAP_DIR, file), "utf8") }));
  const publicFunctions = STEPS.flatMap((step) => step.functions)
    .filter((fn) => fn.startsWith("public."))
    .map((fn) => fn.slice("public.".length));

  it("there is at least one public SP3 function to check", () => {
    expect(publicFunctions.length).toBeGreaterThan(0);
  });

  for (const name of publicFunctions) {
    it(`${name} is excluded in 327 with its comment and pinned by an SP3 pgTAP file`, () => {
      expect(exclusionProblems(name, text327, sp3Files)).toEqual([]);
    });
  }

  it("self-test: a name missing from 327, one without its comment and one with no pinning file are each reported", () => {
    const good: PgtapFile = {
      file: "438_sp3_x.test.sql",
      text: "platform_x prosecdef search_path has_function_privilege",
    };
    const listed = "  'platform_x' -- SP3 step 9: re-pinned on purpose by SP3\n";
    expect(exclusionProblems("platform_x", listed, [good])).toEqual([]);
    expect(exclusionProblems("platform_x", "  'other'\n", [good])).toHaveLength(1);
    expect(exclusionProblems("platform_x", "  'platform_x' -- SP3 step 9\n", [good])).toHaveLength(
      1,
    );
    expect(exclusionProblems("platform_x", listed, [])).toHaveLength(1);
    for (const lacking of ["prosecdef", "search_path", "has_function_privilege"])
      expect(
        exclusionProblems("platform_x", listed, [
          { file: "f", text: good.text.replace(lacking, "") },
        ]),
      ).toHaveLength(1);
  });
});
