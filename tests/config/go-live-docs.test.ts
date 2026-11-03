import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M25 step 20 (AT5): the security walk and the go-live checklist.
//  - the walk repeats every `- [ ]` item of the security-checklist skill word for word and gives each a verdict; a "no" is either fixed by
//    a named plan step or listed as an accepted risk; no line accepts script-src 'unsafe-inline'
//  - the checklist has the five acceptance tests, the four Gate 3 criteria, every manual step of plan section 8, the performance items
//    (G7) and the Supabase Free items, each with an owner, a status and an evidence cell
const ROOT = new URL("../../", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const SKILL = read(".claude/skills/security-checklist/SKILL.md");
const WALK = read("docs/go-live/security-walk.md");
const CHECKLIST = read("docs/go-live/checklist.md");
const PLAN = read("docs/plans/2026-11-01-m25-go-live.md");
const SECRET =
  /sb_secret_|sk-ant-|re_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}/;

/** The skill's items: each `- [ ]` line with its indented continuation lines joined by one space. */
function skillItems(): string[] {
  const items: string[] = [];
  let open = false;
  for (const line of SKILL.split("\n")) {
    if (line.startsWith("- [ ] ")) {
      items.push(line.slice(6).trim());
      open = true;
    } else if (open && /^ {2,}\S/.test(line)) {
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      open = false;
    }
  }
  return items;
}

const FIX_STEPS = new Set([
  "1",
  "2",
  "2a",
  "2b",
  "3",
  "4",
  "4a",
  ...Array.from({ length: 17 }, (_, i) => String(i + 5)),
]);

type Entry = { item: string; block: string };
/** Each `- [ ]` line of the walk with the lines under it, up to the next item or heading. */
function walkEntries(): Entry[] {
  const entries: Entry[] = [];
  let open = false;
  for (const line of WALK.split("\n")) {
    if (line.startsWith("- [ ] ")) {
      entries.push({ item: line.slice(6).trim(), block: "" });
      open = true;
    } else if (line.startsWith("#")) {
      open = false;
    } else if (open) {
      entries[entries.length - 1]!.block += `${line}\n`;
    }
  }
  return entries;
}

describe("docs/go-live/security-walk.md", () => {
  const items = skillItems();
  const entries = walkEntries();

  it("reads the skill's items (the parser itself)", () => {
    expect(items.length).toBeGreaterThanOrEqual(25);
    expect(items[0]).toMatch(/^No keys, tokens or passwords/);
    // a continued item is one string
    expect(items.some((item) => item.includes("`.env.example` has fakes only."))).toBe(true);
  });

  it("repeats every item of the skill, word for word and in order, and adds none", () => {
    expect(entries.map((entry) => entry.item)).toEqual(items);
  });

  it.each(items.map((item, index) => [index + 1, item] as const))(
    "item %i has exactly one verdict and, for a no, a fix or an accepted risk",
    (index) => {
      const { block } = entries[index - 1]!;
      const verdicts = [...block.matchAll(/^\s*- verdict: (yes|no|n\/a)\s*$/gm)].map((m) => m[1]);
      expect(verdicts, "one verdict").toHaveLength(1);
      expect(block).toMatch(/^\s*- evidence: \S/m);
      if (verdicts[0] === "no") {
        const fix = /^\s*- fix: step (\S+)\s*$/m.exec(block)?.[1];
        const accepted = /^\s*- accepted risk: (\S.*)$/m.exec(block)?.[1];
        expect(Boolean(fix) !== Boolean(accepted), "a fix or an accepted risk").toBe(true);
        if (fix) expect(FIX_STEPS.has(fix), `step ${fix} exists`).toBe(true);
      }
    },
  );

  it("lists the accepted risks the plan names", () => {
    expect(WALK).toContain("accepted risk: style-src 'unsafe-inline' (ADR-028)");
    expect(WALK).toContain(
      "accepted risk: an offline shell page replays its cached nonce (ADR-028)",
    );
    expect(WALK).toContain("accepted risk: invoice files not backed up");
  });

  it("accepts no unsafe-inline script policy anywhere", () => {
    for (const line of WALK.split("\n")) {
      if (/accepted risk:/i.test(line)) expect(line, line).not.toMatch(/script-src|script/i);
      expect(line, line).not.toMatch(/script-src\s+'unsafe-inline'/);
    }
    expect(WALK).toMatch(/script-src has no 'unsafe-inline'/);
  });

  it("has nothing that looks like a secret", () => {
    expect(WALK).not.toMatch(SECRET);
  });
});

type Row = { id: string; item: string; owner: string; status: string; evidence: string };
const rows: Row[] = CHECKLIST.split("\n")
  .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  )
  .filter((cells) => cells.length === 5 && cells[0] !== "ID")
  .map(([id, item, owner, status, evidence]) => ({
    id: id!.replace(/`/g, ""),
    item: item!,
    owner: owner!,
    status: status!,
    evidence: evidence!,
  }));
const byId = (id: string) => rows.find((row) => row.id === id);

describe("docs/go-live/checklist.md", () => {
  it("gives every row an owner, a status and an evidence cell that says done or to fill", () => {
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) {
      expect(["founder", "DigiAlto", "client"], row.id).toContain(row.owner);
      expect(["open", "done", "optional"], row.id).toContain(row.status);
      expect(row.evidence, row.id).toMatch(/^(done|to fill): \S/);
      if (row.status === "done") expect(row.evidence, row.id).toMatch(/^done: /);
    }
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("has the five acceptance tests of the milestone", () => {
    for (const n of [1, 2, 3, 4, 5]) expect(byId(`AT${n}`), `AT${n}`).toBeDefined();
    expect(byId("AT1")!.evidence).toContain("service-sim");
    expect(byId("AT2")!.item).toMatch(/check-headers/);
    expect(byId("AT5")!.evidence).toContain("docs/go-live/security-walk.md");
  });

  it("has the four Gate 3 criteria", () => {
    expect(rows.filter((row) => row.id.startsWith("G3-")).map((row) => row.id)).toEqual([
      "G3-1",
      "G3-2",
      "G3-3",
      "G3-4",
    ]);
    expect(byId("G3-2")!.item).toMatch(/under 5%/);
    expect(byId("G3-4")!.item).toMatch(/90 s/);
  });

  it("has every numbered manual step of plan section 8", () => {
    const section = PLAN.slice(PLAN.indexOf("\n## 8. "), PLAN.indexOf("\n## 9. "));
    const steps = [...section.matchAll(/^(\d+)\. \*\*/gm)].map((m) => m[1]!);
    expect(steps.length).toBe(16);
    for (const n of steps) expect(byId(`S8-${n}`), `S8-${n}`).toBeDefined();
  });

  it("carries the founder's GitHub environments and Vault secrets", () => {
    const text = rows.map((row) => `${row.item} ${row.evidence}`).join("\n");
    for (const env of ["production-backup", "staging", "production"]) {
      expect(text, env).toContain(`\`${env}\``);
    }
    for (const name of [
      "SUPABASE_DB_URL",
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "BACKUP_ENCRYPTION_PASSPHRASE",
      "BACKUP_DRIVE_SA_JSON",
      "BACKUP_DRIVE_FOLDER_ID",
      "PRODUCTION_PROJECT_REF",
      "BACKUP_KEEP_COPIES",
      "VERCEL_AUTOMATION_BYPASS_SECRET",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_DB_PASSWORD",
      "SUPABASE_PROJECT_REF",
      "app_base_url",
      "cron_secret",
      "vercel_protection_bypass",
    ]) {
      expect(text, name).toContain(name);
    }
    expect(text).toContain("Content manager");
    expect(text).toMatch(/main only/);
    expect(byId("S8-2")!.item).toMatch(/required reviewer/);
  });

  it("has the performance items, with the verdict of docs/go-live/csp-impact.md", () => {
    for (const id of ["G7-1", "G7-2", "G7-3", "G7-4"]) expect(byId(id), id).toBeDefined();
    expect(byId("G7-4")!.evidence).toContain("docs/go-live/csp-impact.md");
    expect(byId("G7-4")!.item).toMatch(/stop/);
  });

  it("has the Supabase Free items, the pause rehearsal being optional", () => {
    expect(byId("FREE-1")!.item).toMatch(/backup-failure/);
    expect(byId("FREE-2")!.item).toMatch(/36 hours/);
    expect(byId("FREE-3")!.item).toMatch(/custom domain/);
    expect(byId("FREE-3")!.item).toMatch(/Q188/);
    expect(byId("FREE-4")!.status).toBe("optional");
    expect(byId("FREE-4")!.item).toMatch(/pause/);
  });

  it("says that setting PRODUCTION_PROJECT_REF arms the backups", () => {
    expect(byId("S8-9")!.item).toMatch(/Setting `PRODUCTION_PROJECT_REF` arms the backups/);
  });

  it("never says Supabase's daily backups are enabled (the Free plan has none)", () => {
    expect(CHECKLIST).not.toMatch(/daily backups enabled/i);
    expect(CHECKLIST).toMatch(/no Supabase-side backups/i);
  });

  it("has the iPhone offline check on staging", () => {
    expect(byId("IPHONE-1")!.item).toMatch(/flight mode/);
  });

  it("has nothing that looks like a secret", () => {
    expect(CHECKLIST).not.toMatch(SECRET);
  });
});
