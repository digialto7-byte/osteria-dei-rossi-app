import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The comment above `npm ci` must be honest: the install runs without the secrets, but an install script could change
// node_modules/.bin, which later steps run with the secrets set. --ignore-scripts is not possible: the supabase package
// downloads its binary at install.
const FILES = [
  ".github/workflows/backup-daily.yml",
  ".github/workflows/backup-restore-weekly.yml",
  ".github/workflows/deploy-production.yml",
];

describe("the comment above npm ci", () => {
  it.each(FILES)("%s does not claim that no install script sees the secrets", (file) => {
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("so no dependency install script sees them");
    const comment = text
      .split("\n")
      .filter((line) => line.trim().startsWith("#"))
      .join("\n");
    expect(comment).toContain("node_modules/.bin");
    expect(comment).toContain("--ignore-scripts");
    expect(comment).toContain("supabase");
  });
});
