import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// Reads `key = value` from a TOML section without a parser dependency; enough for these checks.
function tomlValue(toml: string, section: string, key: string): string | undefined {
  const start = toml.indexOf(`\n[${section}]\n`);
  if (start === -1) return undefined;
  const rest = toml.slice(start + section.length + 4);
  const body = rest.slice(0, rest.search(/\n\[/) === -1 ? undefined : rest.search(/\n\[/));
  return body.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim();
}

// Vercel skips a deployment when the ignore command exits 0 and builds on any other exit code. Docs-only changes (docs/ or any .md file) are
// skipped to save the free plan's build and Function Storage quota. On a shallow clone with no HEAD^, git exits 128 and Vercel builds: safe.
const IGNORE_COMMAND = "git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)*.md'";

describe("vercel.json", () => {
  const config = JSON.parse(read("vercel.json")) as Record<string, unknown>;

  it("pins functions to Frankfurt (EU)", () => {
    expect(config.regions).toEqual(["fra1"]);
  });

  it("holds only the schema, the region and the docs-only ignore command", () => {
    expect(Object.keys(config).sort()).toEqual(["$schema", "ignoreCommand", "regions"]);
    expect(config.ignoreCommand).toBe(IGNORE_COMMAND);
  });

  describe("the ignore command, run in a scratch repository", () => {
    const git = (cwd: string, ...args: string[]) => {
      const run = spawnSync("git", args, { cwd, encoding: "utf8" });
      if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
    };
    const scratch = (): string => {
      const dir = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
      git(dir, "init", "-q");
      git(dir, "config", "user.email", "ci@example.test");
      git(dir, "config", "user.name", "CI");
      git(dir, "config", "commit.gpgsign", "false");
      mkdirSync(join(dir, "docs"));
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "docs", "plan.md"), "a\n");
      writeFileSync(join(dir, "README.md"), "a\n");
      writeFileSync(join(dir, "src", "app.ts"), "a\n");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "first");
      return dir;
    };
    const ignoreExit = (dir: string): number | null =>
      spawnSync("sh", ["-c", String(config.ignoreCommand)], { cwd: dir }).status;
    const commit = (dir: string, files: string[]) => {
      for (const file of files) writeFileSync(join(dir, file), "b\n");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "change");
    };

    it("skips (exit 0) when only docs/ and .md files changed", () => {
      const dir = scratch();
      try {
        commit(dir, ["docs/plan.md", "README.md"]);
        expect(ignoreExit(dir)).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("builds (exit 1) when anything else changed, even alongside docs", () => {
      const dir = scratch();
      try {
        commit(dir, ["docs/plan.md", "src/app.ts"]);
        expect(ignoreExit(dir)).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("builds (non-zero) when there is no parent commit, as on a shallow clone", () => {
      const dir = scratch();
      try {
        expect(ignoreExit(dir)).not.toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("supabase/config.toml (local auth)", () => {
  const toml = read("supabase/config.toml");
  const APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

  it("redirects only to the app's own origins (acceptance test 12)", () => {
    const siteUrl = JSON.parse(tomlValue(toml, "auth", "site_url") ?? "null");
    const redirects: string[] = JSON.parse(
      tomlValue(toml, "auth", "additional_redirect_urls") ?? "[]",
    );
    expect(APP_ORIGINS).toContain(new URL(siteUrl).origin);
    expect(redirects.length).toBeGreaterThan(0);
    for (const pattern of redirects) {
      // A trailing ** only allows the callback's query string; nothing may precede it.
      expect(pattern).toMatch(/^[^*]+(\*\*)?$/);
      const url = new URL(pattern.replace(/\*\*$/, ""));
      expect(APP_ORIGINS).toContain(url.origin);
      expect(url.pathname).toBe("/api/auth/callback");
    }
  });

  it("turns off self-signup but keeps email (magic-link) login on", () => {
    expect(tomlValue(toml, "auth", "enable_signup")).toBe("false");
    // [auth.email] enable_signup = false disables the email provider itself, magic links included.
    expect(tomlValue(toml, "auth.email", "enable_signup")).toBe("true");
  });

  it("enables the access token hook from the app schema", () => {
    expect(tomlValue(toml, "auth.hook.custom_access_token", "enabled")).toBe("true");
    expect(tomlValue(toml, "auth.hook.custom_access_token", "uri")).toBe(
      '"pg-functions://postgres/app/custom_access_token_hook"',
    );
  });

  it("time-boxes sessions to 30 days", () => {
    expect(tomlValue(toml, "auth.sessions", "timebox")).toBe('"720h"');
  });
});
