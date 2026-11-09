import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// fix/ci-pin-ubuntu-2404 (2026-11-09): `ubuntu-latest` moved to Ubuntu 26.04, which Playwright 1.56.1 does not support:
// `playwright install-deps` printed "Failed to install dependencies for ubuntu26.04-x64" and exited 0, then every WebKit
// test failed to launch (libwayland-server.so.0 missing; run 42681111478, PR #64). Every job before it ran on 24.04. The
// workflows that run a browser are pinned to ubuntu-24.04, and the Playwright cache (its key has no OS version in it, and
// it holds 24.04 .deb files) is warmed on the same image CI reads it from. Move the pin only with a Playwright version
// that supports the new image.
const workflow = (name: string) =>
  readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");
const runsOn = (text: string) => [...text.matchAll(/runs-on: (.+)/g)].map((m) => m[1]);

describe("the workflows that run Playwright are pinned to a runner image it supports", () => {
  it.each(["ci.yml", "playwright-cache.yml", "perf-dashboard-4g.yml"])(
    "%s runs every job on ubuntu-24.04",
    (name) => {
      const jobs = runsOn(workflow(name));
      expect(jobs.length).toBeGreaterThan(0);
      expect(new Set(jobs)).toEqual(new Set(["ubuntu-24.04"]));
    },
  );

  // Every workflow file is sorted into one list, so a new workflow fails here until someone decides whether it runs a
  // browser. A browser-free one must not mention Playwright, a browser engine or the e2e script.
  it("every other workflow is listed as browser-free and starts no browser", () => {
    const pinned = ["ci.yml", "playwright-cache.yml", "perf-dashboard-4g.yml"];
    const browserFree = [
      "backup-daily.yml",
      "backup-restore-weekly.yml",
      "backup-selftest.yml",
      "demo-staging.yml",
      "deploy-production.yml",
      "deploy-staging.yml",
      "extraction-contract.yml",
      "perf-order-entry.yml",
      "t1-staging.yml",
    ];
    const files = readdirSync(new URL("../../.github/workflows/", import.meta.url)).filter((f) =>
      /\.ya?ml$/.test(f),
    );
    expect(files.sort()).toEqual([...pinned, ...browserFree].sort());
    for (const name of browserFree) {
      expect(workflow(name), name).not.toMatch(
        /playwright|chromium|webkit|npm run e2e|dashboard-4g/i,
      );
    }
  });
});
