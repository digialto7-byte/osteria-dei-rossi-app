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
  "Two-step verification (TOTP)",
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

    it("says the invoice-file backup needs the passphrase for as long as a pack exists, and what rotation means (ADR-034, Q-F6)", () => {
      const row = rowOf("BACKUP_ENCRYPTION_PASSPHRASE")!.cells.join(" ");
      expect(row).toContain("invoice-file packs");
      expect(row).toContain("never deleted");
      expect(row).toContain("full_files");
      expect(row).toContain("delete the older packs by hand");
    });

    it("says SUPABASE_SECRET_KEY also lives in production-backup, for the invoice-file step only, and is rotated there too", () => {
      const row = rowOf("SUPABASE_SECRET_KEY")!.cells.join(" ");
      expect(row).toContain("`production-backup`");
      expect(row).toContain("invoice-file backup");
      expect(row).toMatch(/update Vercel, `staging` and `production-backup`/);
    });

    it("says the backup copies setting counts the files manifests and never packs", () => {
      const row = rowOf("BACKUP_KEEP_COPIES")!.cells.join(" ");
      expect(row).toContain("files manifests");
      expect(row).toContain("packs are never deleted");
    });

    it("says in the production-backup block that the secret key reaches the invoice-files step only", () => {
      const block = SECRETS.slice(SECRETS.indexOf("### GitHub environment `production-backup`"))
        .slice(3)
        .split(/\n### /)[0]!;
      expect(block).toMatch(/`SUPABASE_SECRET_KEY`[^\n]*invoice-files step only/);
      expect(block).toMatch(/dedicated|separate secret key/);
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
        "SUPABASE_SECRET_KEY",
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
        "SUPABASE_SECRET_KEY",
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
      expect(SECRETS).toMatch(/Until the seven secrets are set/);
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

  it("names the files step's Supabase egress in the Free section (ADR-034)", () => {
    const free = section("Supabase Free: pause, resume, keep active");
    expect(free).toContain("invoice files");
    expect(free).toContain("full_files");
    expect(free).toContain("egress");
  });

  describe("Backups and restore: the invoice files (ADR-034, F11)", () => {
    const backups = section("Backups and restore");

    it("describes the files step, its names and the weekly checks, and cites its tests", () => {
      expect(backups).toContain("osteria-files-");
      expect(backups).toContain("osteria-files-manifest-");
      expect(backups).toContain("full_files");
      expect(backups).toContain("(e) to (i)");
      expect(backups).toContain("tests/scripts/backup/files.test.ts");
      expect(backups).toContain("tests/scripts/backup/files-verify.test.ts");
    });

    it("no longer says the invoice PDFs are not backed up", () => {
      expect(backups).not.toContain("What is not backed up:** invoice");
      expect(backups).not.toContain("Losing the project loses the PDFs");
      expect(backups).toContain("What is backed up");
    });

    it("says packs are never deleted by the code, and who deletes them after the retention (Q-F5)", () => {
      expect(backups).toMatch(/packs are never deleted/i);
      expect(backups).toContain("Q-F5");
    });

    it("explains how to open a pack and a manifest by hand, without printing paths into a shared log", () => {
      expect(backups).toContain("osteria-files-<UTC stamp>-<target>-<nn>.tar.gpg");
      expect(backups).toContain("index.json");
      expect(backups).toContain("o/<n>");
      expect(backups).toContain("osteria-files-manifest-<UTC stamp>-<target>.json.gpg");
      expect(backups).toMatch(/supplier invoices|object paths/);
    });

    it("has a 'Recover the invoice files' procedure: newest manifest, its packs, try one file first, no tool (Q-F3)", () => {
      const at = backups.indexOf("**Recover the invoice files");
      expect(at).toBeGreaterThan(-1);
      const text = backups.slice(at, backups.indexOf("**Not yet rehearsed", at));
      expect(text).toContain("newest manifest");
      expect(text).toContain("removedAt");
      expect(text).toContain("`invoices` bucket");
      expect(text).toMatch(/try one file first/i);
      expect(text).toContain("no tool");
    });

    it("explains files_bucket_anomaly and the other files error codes", () => {
      for (const code of [
        "files_bucket_anomaly",
        "files_run_cap_reached",
        "files_manifest_unreadable",
        "files_path_invalid",
        "files_download_failed",
        "files_manifest_missing",
        "files_manifest_stale",
      ]) {
        expect(backups, code).toContain(`\`${code}\``);
      }
    });

    it("says files_path_invalid also covers a path that could leave the bucket (empty, . or .. segment, leading /)", () => {
      const row = backups.split("\n").find((l) => l.startsWith("| `files_path_invalid`"))!;
      expect(row).toMatch(/`\.\.`/);
      expect(row).toMatch(/leading `\/`/);
      expect(row).toMatch(/empty segment/);
    });

    it("says files_download_failed can mean an object deleted between listing and download, and that the next run recovers", () => {
      const row = backups.split("\n").find((l) => l.startsWith("| `files_download_failed`"))!;
      expect(row).toMatch(/deleted between (the )?listing and (the )?download/);
      expect(row).toMatch(/next run recovers/);
    });

    it("says the secret key reaches only the files step and, in-process, only the downloader; child processes do not get it", () => {
      const block = SECRETS.slice(SECRETS.indexOf("### GitHub environment `production-backup`"))
        .slice(3)
        .split(/\n### /)[0]!
        .replace(/\s+/g, " ");
      expect(block).toMatch(/only the downloader/);
      expect(block).toMatch(/child processes[^.]*do not get it/);
    });

    it("warns that a --full run drops removed objects from the manifest and their older packs stay the only record", () => {
      expect(backups).toContain("`full_files` run drops");
      expect(backups).toMatch(/older packs[^\n]*only record/);
      expect(backups).toContain("do not delete");
    });

    it("explains that packs uploaded before a failed run are orphans and get re-packed by the next run", () => {
      expect(backups).toMatch(/orphan/i);
      expect(backups).toMatch(/re-packed by the next run/);
      expect(backups).toContain("failure after some packs were uploaded");
    });
  });

  it("asks, on go-live day, for a pack and a manifest in Drive", () => {
    const day = section("Go-live day");
    expect(day).toContain("osteria-files-");
    expect(day).toContain("manifest");
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

  describe("Two-step verification (TOTP) (P2-1 B9)", () => {
    const mfa = section("Two-step verification (TOTP)");

    it("lists the founder's staging and production steps M-1 to M-7", () => {
      for (const step of ["M-1", "M-2", "M-3", "M-4", "M-5", "M-6", "M-7"]) {
        expect(mfa, step).toContain(step);
      }
    });

    it("names the kill switch and how enforcement is set, with the script and its arguments", () => {
      expect(mfa).toContain("scripts/set-mfa-enforcement.ts");
      expect(mfa).toMatch(/--mode off/);
      expect(mfa).toMatch(/kill switch/i);
      expect(mfa).toMatch(/--mode required/);
    });

    it("qualifies every mention of the kill switch as for owners (FD31: it never rescues an admin)", () => {
      const lines = mfa.split("\n").filter((l) => /kill switch/i.test(l) && /--mode off/.test(l));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l).toMatch(/owners?/i);
    });

    it("makes scripts/mfa-reset.ts the D2 reset path, with an 'Azzerare la verifica' procedure", () => {
      expect(mfa).toContain("scripts/mfa-reset.ts");
      expect(mfa).toContain("Azzerare la verifica");
      expect(mfa).toMatch(/--user/);
      expect(mfa).toMatch(/--actor/);
    });

    it("says which actor id to pass, and that created_by then means 'requested by' (lead 2026-11-13)", () => {
      expect(mfa).toMatch(/another active admin/i);
      expect(mfa).toMatch(/the target'?s own app_user id/i);
      expect(mfa).toMatch(/requested by/i);
    });

    it("tells the operator to phone the person first and to enrol a new admin at once", () => {
      expect(mfa).toMatch(/phone|call/i);
      expect(mfa).toMatch(/enrol|enroll/i);
      expect(mfa).toMatch(/at once|straight away|immediately/i);
    });

    it("describes the wrong-code retention job", () => {
      expect(mfa).toMatch(/mfa-failure-retention/);
      expect(mfa).toMatch(/30 days/);
    });

    it("cites a test", () => {
      expect(mfa).toMatch(/\(test: [^)]+\)/);
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
