import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 10 (plan §5): .env.example lists every environment name the backup scripts and the header check read,
// with fake values only.
const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const example = new Map(
  read(".env.example")
    .split("\n")
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const),
);

/** Names read as `process.env.X` or `env.X` in a source text. */
function envNames(source: string): string[] {
  return [...source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)].map((m) => m[1]!);
}

describe(".env.example", () => {
  it("lists the backup secrets as replace-me", () => {
    for (const name of [
      "SUPABASE_DB_URL",
      "BACKUP_ENCRYPTION_PASSPHRASE",
      "BACKUP_DRIVE_SA_JSON",
      "BACKUP_DRIVE_FOLDER_ID",
    ]) {
      expect(example.get(name), name).toBe("replace-me");
    }
  });

  it("lists the Vercel bypass secret with an empty value (empty sends no header)", () => {
    expect(example.get("VERCEL_AUTOMATION_BYPASS_SECRET")).toBe("");
  });

  it("lists every name read under scripts/backup/ and by scripts/check-headers.ts", () => {
    const files = [
      ...readdirSync(new URL("scripts/backup/", ROOT)).map((f) => `scripts/backup/${f}`),
      "scripts/check-headers.ts",
    ];
    const used = new Set(files.flatMap((f) => envNames(read(f))));
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(example.has(name), name).toBe(true);
  });

  it("holds no real-looking secret", () => {
    // The reservation keys are at least 32 characters (MIN_RESERVATION_KEY_CHARS), so their local fakes are longer than `replace-me`: they must
    // start with it, name themselves local and end in zeros, and equal the fake Vault values of supabase/seed.sql. The three mail settings are config, not secrets.
    const LOCAL_FAKE = /^replace-me-local-[a-z-]+-0000$/;
    const CONFIG = new Map([
      ["MAIL_TRANSPORT", "mailpit"],
      ["MAIL_FROM", "prenotazioni@example.com"],
      ["APP_PUBLIC_ORIGIN", "http://localhost:3000"],
    ]);
    for (const [name, value] of example) {
      if (CONFIG.has(name)) expect(value, name).toBe(CONFIG.get(name));
      else if (/^RESERVATION_(GATE|LINK)_KEY/.test(name)) expect(value, name).toMatch(LOCAL_FAKE);
      else expect(value, name).toMatch(/^(|replace-me|http:\/\/127\.0\.0\.1:\d+)$/);
    }
  });

  it("lists the reservation and mail names (B6); the gate key equals the seed's fake Vault value", () => {
    for (const name of [
      "RESERVATION_GATE_KEY",
      "RESERVATION_LINK_KEY",
      "MAIL_TRANSPORT",
      "MAIL_FROM",
      "MAILPIT_URL",
      "APP_PUBLIC_ORIGIN",
    ]) {
      expect(example.has(name), name).toBe(true);
    }
    expect(read("supabase/seed.sql")).toContain(
      `'${example.get("RESERVATION_GATE_KEY")}', 'reservation_gate_key'`,
    );
    expect(example.get("MAILPIT_URL")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("ignores /tmp/ in git (the backup work directory)", () => {
    expect(read(".gitignore")).toMatch(/^\/tmp\/$/m);
  });
});
