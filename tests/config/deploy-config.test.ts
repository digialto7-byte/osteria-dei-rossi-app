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
// skipped to save the free plan's build and Function Storage quota. The comparison is with VERCEL_GIT_PREVIOUS_SHA, the last successful
// deployment of the branch (Vercel exposes it only to the Ignored Build Step; empty on a branch's first deployment), so every commit of a
// push is seen, not only the tip (code review on #119: HEAD^ missed a code commit followed by a docs commit). Empty variable, or a SHA
// the clone does not have: non-zero, so Vercel builds.
const IGNORE_COMMAND =
  "test -n \"$VERCEL_GIT_PREVIOUS_SHA\" && git diff --quiet \"$VERCEL_GIT_PREVIOUS_SHA\" HEAD -- . ':(exclude)docs' ':(exclude)*.md'";

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
    // Hermetic git: no global or system config (hooks, signing), and no GIT_DIR / GIT_INDEX_FILE leaking in from a caller.
    const gitEnv = (): NodeJS.ProcessEnv => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      };
      for (const key of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "VERCEL_GIT_PREVIOUS_SHA"])
        delete env[key];
      return env;
    };
    const git = (cwd: string, ...args: string[]): string => {
      const run = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv() });
      if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
      return run.stdout.trim();
    };
    const write = (dir: string, file: string, text: string) => {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), text);
    };
    const FILES = [
      "docs/plan.md",
      "docs/sub/runbook.json",
      "README.md",
      "src/app.ts",
      "src/a/notes.md",
    ];
    const scratch = (): { dir: string; base: string } => {
      const dir = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
      git(dir, "init", "-q");
      git(dir, "config", "user.email", "ci@example.test");
      git(dir, "config", "user.name", "CI");
      git(dir, "config", "commit.gpgsign", "false");
      for (const file of FILES) write(dir, file, "a\n");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "first");
      return { dir, base: git(dir, "rev-parse", "HEAD") };
    };
    const commit = (dir: string, files: string[]) => {
      for (const file of files) write(dir, file, `${Math.random()}\n`);
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "change");
    };
    const ignoreExit = (dir: string, previous: string | undefined): number | null => {
      const env = gitEnv();
      if (previous !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = previous;
      return spawnSync("sh", ["-c", String(config.ignoreCommand)], { cwd: dir, env }).status;
    };
    const inScratch = (run: (repo: { dir: string; base: string }) => void) => {
      const repo = scratch();
      try {
        run(repo);
      } finally {
        rmSync(repo.dir, { recursive: true, force: true });
      }
    };

    it("skips (exit 0) when every commit since the last deployment touched only docs/ (any file) and .md files (any depth)", () => {
      inScratch(({ dir, base }) => {
        commit(dir, ["docs/plan.md", "README.md"]);
        commit(dir, ["docs/sub/runbook.json", "src/a/notes.md"]);
        expect(ignoreExit(dir, base)).toBe(0);
      });
    });

    it("builds (exit 1) when a code commit is followed by a docs-only commit in the same push", () => {
      inScratch(({ dir, base }) => {
        commit(dir, ["src/app.ts"]);
        commit(dir, ["docs/plan.md"]);
        expect(ignoreExit(dir, base)).toBe(1);
      });
    });

    it("builds (exit 1) when code changed alongside docs", () => {
      inScratch(({ dir, base }) => {
        commit(dir, ["docs/plan.md", "src/app.ts"]);
        expect(ignoreExit(dir, base)).toBe(1);
      });
    });

    it("builds (non-zero) on a branch's first deployment, when the variable is empty or unset", () => {
      inScratch(({ dir }) => {
        commit(dir, ["docs/plan.md"]);
        expect(ignoreExit(dir, "")).not.toBe(0);
        expect(ignoreExit(dir, undefined)).not.toBe(0);
      });
    });

    it("builds (non-zero) when the last deployed commit is not in the clone", () => {
      inScratch(({ dir }) => {
        commit(dir, ["docs/plan.md"]);
        expect(ignoreExit(dir, "0123456789abcdef0123456789abcdef01234567")).not.toBe(0);
      });
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
