import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// chore/ci-playwright-cache (2026-11-05): the supabase job downloaded Chromium and WebKit on every run, about 5 minutes
// per shard, and one download hung for 22 minutes until the shard's 30-minute cap cancelled it before any test ran
// (run 41898266512). The browsers are now cached, keyed on the exact Playwright version in package-lock.json; a hit
// installs only the system packages, a miss does the full install, and both steps fail fast on a hang.
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const job = ci.slice(ci.indexOf("  supabase:"), ci.indexOf("  t1-spike:"));

/** The YAML text of the step whose `- name:` line contains `name`, up to the next step. */
function step(name: string): string {
  const start = job.indexOf(`- name: ${name}`);
  if (start < 0) throw new Error(`no step ${name}`);
  const rest = job.slice(start);
  const next = rest.slice(1).search(/\n {6}- /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("CI caches the Playwright browsers", () => {
  it("reads the Playwright version from package-lock.json", () => {
    const version = step("Playwright version");
    expect(version).toMatch(/id: pw\n/);
    expect(version).toContain("package-lock.json");
    expect(version).toContain("node_modules/@playwright/test");
    expect(version).toContain('>> "$GITHUB_OUTPUT"');
    // An unreadable version fails the step rather than caching under a key with no version in it.
    expect(version).toContain('test -n "$version"');
  });

  it("caches ~/.cache/ms-playwright under a key with that exact version", () => {
    const cache = step("Cache Playwright browsers");
    expect(cache).toMatch(/id: pw-cache\n/);
    expect(cache).toMatch(/uses: actions\/cache@v\d+\n/);
    expect(cache).toContain("path: ~/.cache/ms-playwright");
    expect(cache).toMatch(
      /key: playwright-\$\{\{ runner\.os \}\}-\$\{\{ steps\.pw\.outputs\.version \}\}-/,
    );
  });

  it("the key names the browsers that both installs fetch", () => {
    const key = /key: (.+)/.exec(step("Cache Playwright browsers"))![1]!;
    expect(key.endsWith("-chromium-webkit")).toBe(true);
    expect(step("Install Playwright browsers (cache miss)")).toMatch(/chromium webkit$/m);
    expect(step("Install Playwright system dependencies (cache hit)")).toMatch(/chromium webkit$/m);
  });

  it("a miss does the full install, a hit only the system packages, each with its own time limit", () => {
    const miss = step("Install Playwright browsers (cache miss)");
    expect(miss).toContain("if: steps.pw-cache.outputs.cache-hit != 'true'");
    expect(miss).toContain("run: npx playwright install --with-deps chromium webkit");
    const hit = step("Install Playwright system dependencies (cache hit)");
    expect(hit).toContain("if: steps.pw-cache.outputs.cache-hit == 'true'");
    expect(hit).toContain("run: npx playwright install-deps chromium webkit");
    for (const install of [miss, hit]) {
      const limit = /timeout-minutes: (\d+)\n/.exec(install);
      expect(limit, install).not.toBeNull();
      expect(Number(limit![1])).toBeLessThanOrEqual(10);
    }
  });

  it("the version, the cache and both installs come after npm ci and before the tests", () => {
    const order = [
      "run: npm ci",
      "- name: Playwright version",
      "- name: Cache Playwright browsers",
      "- name: Install Playwright browsers (cache miss)",
      "- name: Install Playwright system dependencies (cache hit)",
      "npx playwright test --shard=",
    ].map((text) => job.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
