import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// fix/ci-playwright-cache-warm (2026-11-07): CI restores the Playwright browsers and apt's .deb files and, on a miss, installs them
// within a 10-minute limit. apt's mirror has served the 114 MB of system packages at a few KB/s (runs 42083421981, 42090745608),
// so a miss could fail every shard and main had no cache to give. This workflow fills the same cache on main, where every pull
// request can read it, with time to spare. It must save exactly what CI restores, or CI never hits.
const warm = readFileSync(
  new URL("../../.github/workflows/playwright-cache.yml", import.meta.url),
  "utf8",
);
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

/** The YAML text of the step whose `- name:` line contains `name`, up to the next step. */
function step(text: string, name: string): string {
  const start = text.indexOf(`- name: ${name}`);
  if (start < 0) throw new Error(`no step ${name}`);
  const rest = text.slice(start);
  const next = rest.slice(1).search(/\n {6}- /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
const pathsOf = (text: string) => text.slice(text.indexOf("path:"), text.indexOf("key:"));
const keyOf = (text: string) => /key: (.+)/.exec(text)![1]!.trim();

describe("the Playwright cache warm-up workflow", () => {
  it("runs on main pushes that change the Playwright version or the cache steps, weekly and by hand; never on a pull request", () => {
    const on = warm.slice(warm.indexOf("\non:"), warm.indexOf("\npermissions:"));
    expect(on).toMatch(/push:\n {4}branches: \[main\]\n {4}paths:\n/);
    for (const path of [
      "package-lock.json",
      ".github/workflows/playwright-cache.yml",
      ".github/workflows/ci.yml",
    ]) {
      expect(on).toContain(`- ${path}`);
    }
    expect(on).toMatch(/schedule:\n {4}- cron: "[^"]+"/);
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toContain("pull_request");
  });

  it("holds no secret and may only read the repository", () => {
    expect(warm).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(warm).not.toContain("secrets.");
    expect(warm).not.toMatch(/environment:/);
    expect(warm).toContain("persist-credentials: false");
  });

  it("looks the cache up under CI's exact key and paths, and does nothing more on a hit", () => {
    const lookup = step(warm, "Cache Playwright browsers");
    const restore = step(ci, "Cache Playwright browsers");
    expect(lookup).toMatch(/uses: actions\/cache\/restore@v\d+\n/);
    expect(lookup).toContain("lookup-only: true");
    expect(keyOf(lookup)).toBe(keyOf(restore));
    expect(pathsOf(lookup)).toBe(pathsOf(restore));
    const script = (text: string) => /run: \|\n((?: {10}.*(?:\n|$))+)/.exec(text)![1]!.trimEnd();
    expect(script(step(warm, "Playwright version"))).toBe(script(step(ci, "Playwright version")));
    for (const name of [
      "Install dependencies (cache miss)",
      "Keep apt's downloaded packages",
      "Install Playwright browsers (cache miss)",
      "Save Playwright browsers (cache miss)",
    ]) {
      expect(step(warm, name)).toContain("if: steps.pw-cache.outputs.cache-hit != 'true'");
    }
  });

  it("on a miss installs and stores the same files as CI, with time to spare, and saves under the looked-up key", () => {
    const install = step(warm, "Install Playwright browsers (cache miss)");
    const ciInstall = step(ci, "Install Playwright browsers (cache miss)");
    const commands = (text: string) => text.slice(text.indexOf("run: |"));
    expect(commands(install)).toBe(commands(ciInstall));
    const limit = Number(/timeout-minutes: (\d+)\n/.exec(install)![1]);
    expect(limit).toBeGreaterThanOrEqual(30);
    const save = step(warm, "Save Playwright browsers (cache miss)");
    expect(save).toMatch(/uses: actions\/cache\/save@v\d+\n/);
    expect(save).toContain("key: ${{ steps.pw-cache.outputs.cache-primary-key }}");
    expect(pathsOf(save)).toBe(pathsOf(step(ci, "Cache Playwright browsers")));
    expect(step(warm, "Keep apt's downloaded packages")).toContain(
      'APT::Keep-Downloaded-Packages "true"',
    );
  });

  // On a hit npm ci is skipped, so setup-node's npm cache would find no ~/.npm to save and fail its post step (or save an empty
  // cache under the lockfile key that CI then restores).
  it("touches no npm cache", () => {
    expect(warm).not.toMatch(/cache: npm/);
  });

  it("runs on main only, on CI's runner, with CI's cache action versions and apt setting", () => {
    expect(warm).toMatch(/\n {4}if: github\.ref == 'refs\/heads\/main'\n/);
    const runsOn = (text: string) => [...text.matchAll(/runs-on: (.+)/g)].map((m) => m[1]);
    expect(new Set(runsOn(warm))).toEqual(new Set(runsOn(ci)));
    const cacheActions = (text: string) =>
      [
        ...new Set(
          [...text.matchAll(/uses: (actions\/cache\/(?:restore|save)@v\d+)/g)].map((m) => m[1]),
        ),
      ].sort();
    expect(cacheActions(warm)).toEqual(cacheActions(ci));
    const keep = (text: string) =>
      /run: \|\n((?: {10}.*(?:\n|$))+)/
        .exec(step(text, "Keep apt's downloaded packages"))![1]!
        .trimEnd();
    expect(keep(warm)).toBe(keep(ci));
  });

  it("is one job with its own time limit, and one run at a time", () => {
    expect(warm).toMatch(
      /\nconcurrency:\n {2}group: playwright-cache\n {2}cancel-in-progress: false\n/,
    );
    const job = Number(/\n {4}timeout-minutes: (\d+)\n/.exec(warm)![1]);
    expect(job).toBeGreaterThanOrEqual(40);
    expect(job).toBeLessThanOrEqual(60);
  });
});
