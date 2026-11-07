import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M25 step 19: docs/runbook.md. The headings are fixed, the secrets table has a row (with where it lives and how to rotate it) for every
// environment name, every GitHub secret, every Vault secret and every account login; the Supabase Free section holds the detection and the
// resume steps; every behaviour the runbook states cites a test that exists; and nothing in it looks like a secret.
const ROOT = new URL("../../", import.meta.url).pathname;
const DOC = readFileSync(join(ROOT, "docs/runbook.md"), "utf8");

const HEADINGS = [
  "Accounts and access",
  "Where every secret lives and how to rotate it",
  "Outage",
  "Supabase Free: pause, resume, keep active",
  "Scheda per il personale: lavorare senza connessione",
  "Scheda per il personale: primo accesso",
  "Device revocation",
  "Backups and restore",
  "Releases",
  "Go-live day",
];

/** The text under one `##` heading, up to the next one. */
function section(title: string): string {
  const start = DOC.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`no section ${title}`);
  const rest = DOC.slice(start + 1);
  const next = rest.slice(3).search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

type Row = { name: string; cells: string[] };
function tableRows(text: string): Row[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .map((cells) => ({ name: cells[0]!.replace(/`/g, ""), cells }));
}

const SECRETS = section("Where every secret lives and how to rotate it");
const secretRows = tableRows(SECRETS);
const rowOf = (name: string) => secretRows.find((row) => row.name === name);

function envNames(): string[] {
  return readFileSync(join(ROOT, ".env.example"), "utf8")
    .split("\n")
    .map((line) => /^([A-Z][A-Z0-9_]+)=/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}
function workflowNames(kind: "secrets" | "vars"): string[] {
  const dir = join(ROOT, ".github/workflows");
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    for (const m of readFileSync(join(dir, file), "utf8").matchAll(
      new RegExp(`${kind}\\.([A-Z][A-Z0-9_]+)`, "g"),
    )) {
      names.add(m[1]!);
    }
  }
  return [...names].sort();
}

// The accounts of project plan §3.11.7 (the last row of its table).
const ACCOUNTS = [
  "Vercel account",
  "Supabase account",
  "Anthropic console account",
  "Google Cloud account",
  "Resend account",
  "Sentry account",
  "GitHub account",
  "Domain registrar account",
];

describe("docs/runbook.md", () => {
  it("has exactly these sections, in this order", () => {
    const found = [...DOC.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(found).toEqual(HEADINGS);
  });

  describe("the secrets table", () => {
    it("has the columns Lives in and How to rotate", () => {
      const header = secretRows[0]!.cells.join(" | ");
      expect(header).toMatch(/Lives in/);
      expect(header).toMatch(/How to rotate/);
    });

    const names = [
      ...new Set([
        ...envNames(),
        ...workflowNames("secrets"),
        ...workflowNames("vars"),
        "app_base_url",
        "cron_secret",
        "vercel_protection_bypass",
        "Resend SMTP credentials",
        ...ACCOUNTS,
      ]),
    ];
    it.each(names)("has a row for %s, with where it lives and how to rotate it", (name) => {
      const row = rowOf(name);
      expect(row, name).toBeDefined();
      expect(row!.cells.length, name).toBeGreaterThanOrEqual(3);
      expect(row!.cells[1], `${name}: lives in`).not.toBe("");
      expect(row!.cells[row!.cells.length - 1], `${name}: how to rotate`).not.toBe("");
    });

    it("says what rotating PIN_PEPPER and the backup passphrase costs", () => {
      expect(rowOf("PIN_PEPPER")!.cells.join(" ")).toContain("every staff PIN must be reset");
      expect(rowOf("BACKUP_ENCRYPTION_PASSPHRASE")!.cells.join(" ")).toContain(
        "old backups need the old passphrase",
      );
    });

    it("keeps the same value in Vercel and Vault for the cron secret and the bypass secret", () => {
      expect(rowOf("cron_secret")!.cells.join(" ").replace(/`/g, "")).toContain(
        "same value as CRON_SECRET",
      );
      expect(rowOf("vercel_protection_bypass")!.cells.join(" ").replace(/`/g, "")).toContain(
        "same value as VERCEL_AUTOMATION_BYPASS_SECRET",
      );
    });

    // The founder's GitHub environments: which secrets and variables each one holds, and who must approve.
    const ENVIRONMENTS: Record<string, string[]> = {
      "production-backup": [
        "SUPABASE_DB_URL",
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "BACKUP_ENCRYPTION_PASSPHRASE",
        "BACKUP_DRIVE_SA_JSON",
        "BACKUP_DRIVE_FOLDER_ID",
        "PRODUCTION_PROJECT_REF",
        "BACKUP_KEEP_COPIES",
      ],
      staging: [
        "SUPABASE_DB_URL",
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "BACKUP_ENCRYPTION_PASSPHRASE",
        "BACKUP_DRIVE_SA_JSON",
        "BACKUP_DRIVE_FOLDER_ID",
        "VERCEL_AUTOMATION_BYPASS_SECRET",
      ],
      production: [
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_DB_PASSWORD",
        "SUPABASE_PROJECT_REF",
        "PRODUCTION_PROJECT_REF",
      ],
    };
    it.each(Object.entries(ENVIRONMENTS))(
      "lists the GitHub environment %s with each of its secrets and variables",
      (environment, wanted) => {
        const block = SECRETS.slice(SECRETS.indexOf(`### GitHub environment \`${environment}\``));
        expect(block, environment).toContain(`### GitHub environment \`${environment}\``);
        const own = block.slice(3).split(/\n### /)[0]!;
        for (const name of wanted) expect(own, `${environment}: ${name}`).toContain(`\`${name}\``);
      },
    );

    it("says production-backup is main only with no reviewer, and production has the founder as reviewer", () => {
      expect(SECRETS).toMatch(/production-backup[\s\S]*main only/);
      expect(SECRETS).toMatch(/no required reviewer/);
      expect(SECRETS).toMatch(/`production`[\s\S]*required reviewer[\s\S]*founder/);
    });

    it("says an armed daily backup fails and opens a backup-failure issue until the secrets are set", () => {
      expect(SECRETS).toMatch(/Until the six secrets are set/);
      expect(SECRETS).toContain("backup-failure");
      expect(SECRETS).toContain("Content manager");
    });

    it("says that setting PRODUCTION_PROJECT_REF arms the backups, and explains both states", () => {
      expect(SECRETS).toContain("Setting PRODUCTION_PROJECT_REF arms the backups.");
      expect(SECRETS).toContain("backups not armed: PRODUCTION_PROJECT_REF is not set");
      expect(SECRETS).toMatch(/Empty or unset \(not armed\)/);
      expect(SECRETS).toMatch(/Set \(armed\)/);
    });
  });

  describe("Supabase Free: pause, resume, keep active", () => {
    const free = section("Supabase Free: pause, resume, keep active");
    it.each(["backup-failure", "auth/v1/health", "resume", "job_stale"])("mentions %s", (word) => {
      expect(free).toContain(word);
    });

    it("gives the three sources with their certainty words", () => {
      expect(free).toMatch(/venue's (own )?use[^\n]*\bsure\b/i);
      expect(free).toMatch(/backup[^\n]*likely, not verified/i);
      expect(free).toMatch(/pg_cron[^\n]*not counted on/i);
    });
  });

  describe("Go-live day", () => {
    it("lists the Vault secrets of each Supabase project", () => {
      const day = section("Go-live day");
      for (const name of ["app_base_url", "cron_secret", "vercel_protection_bypass"]) {
        expect(day, name).toContain(name);
      }
      expect(day).toContain("custom domain");
    });
  });

  describe("staff sheets", () => {
    it("are in Italian and carry no developer words", () => {
      for (const title of [
        "Scheda per il personale: lavorare senza connessione",
        "Scheda per il personale: primo accesso",
      ]) {
        const text = section(title);
        expect(text, title).toMatch(/\b(telefono|tavolo|cucina)\b/);
        expect(text, title).not.toMatch(/\b(API|Vault|GitHub|Supabase|service worker)\b/);
      }
    });
  });

  describe("cited tests", () => {
    const cited = [...DOC.matchAll(/\(test: ([^)]+)\)/g)].flatMap((m) =>
      m[1]!.split(",").map((path) => path.trim()),
    );
    it("cites at least one test, and every one exists", () => {
      expect(cited.length).toBeGreaterThan(0);
      for (const path of cited) expect(existsSync(join(ROOT, path)), path).toBe(true);
    });

    it.each([
      "Device revocation",
      "Scheda per il personale: lavorare senza connessione",
      "Scheda per il personale: primo accesso",
    ])("%s cites a test", (title) => {
      expect(section(title)).toMatch(/\(test: [^)]+\)/);
    });
  });

  it("carries the staff-meal re-save workaround (G8)", () => {
    expect(DOC).toMatch(/staff-meal rule/);
    expect(DOC).toMatch(/re-save/);
  });

  it("has nothing that looks like a secret", () => {
    expect(DOC).not.toMatch(
      /sb_secret_|sk-ant-|re_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}/,
    );
  });
});
