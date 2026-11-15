import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The comment above `npm ci` must be honest: the install runs without the secrets and with --ignore-scripts, so no install script
// can change node_modules/.bin, which later steps run with the secrets set. The supabase CLI needs no install script: its binary
// comes from the optional @supabase/cli-linux-x64 package, not a postinstall download.
const FILES = [
  ".github/workflows/backup-daily.yml",
  ".github/workflows/backup-restore-weekly.yml",
  ".github/workflows/deploy-production.yml",
];

describe("the comment above npm ci", () => {
  it.each(FILES)(
    "%s says the install runs without scripts, and does not claim they are needed",
    (file) => {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("so no dependency install script sees them");
      expect(text).not.toContain("--ignore-scripts is not possible");
      expect(text).not.toContain("downloads its binary at install");
      const comment = text
        .split("\n")
        .filter((line) => line.trim().startsWith("#"))
        .join("\n");
      expect(comment).toContain("node_modules/.bin");
      expect(comment).toContain("--ignore-scripts");
      expect(comment).toContain("@supabase/cli-linux-x64");
      expect(text).toMatch(/run: npm ci --ignore-scripts\n/);
    },
  );
});
