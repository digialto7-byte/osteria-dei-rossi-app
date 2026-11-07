import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";

// fix/e2e-econnreset (2026-11-04): Playwright sends every `page.request.*` call through one keep-alive agent shared
// by all tests in a worker, with no idle limit of its own. `next start` closes idle sockets after Node's default
// 5 s. A request written on a pooled socket just as the server closes it is answered with a reset (`read ECONNRESET`
// on /api/me and /api/batches/proposal in CI). The e2e server keeps idle sockets far longer than any idle gap between a
// worker's requests, so the pool practically never meets the server's limit. Production (Vercel) does not run this command.
const KEEP_ALIVE_MS = 600_000;

const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("the e2e web server", () => {
  it("runs next start with an idle keep-alive limit of at least 10 minutes", () => {
    const command = webServer?.command ?? "";
    expect(command).toMatch(/npm run start -- /);
    const match = /--keepAliveTimeout[ =](\d+)/.exec(command);
    expect(match, command).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(KEEP_ALIVE_MS);
  });

  it("pipes the server's stdout as well as its stderr into the job log", () => {
    expect(webServer?.stdout).toBe("pipe");
    expect(webServer?.stderr ?? "pipe").toBe("pipe");
  });

  it("CI prints the runner's memory and any OOM kill after a failed Playwright run", () => {
    const playwright = ci.indexOf("npx playwright test --shard=");
    const memory = ci.indexOf("free -m");
    expect(playwright).toBeGreaterThan(-1);
    expect(memory).toBeGreaterThan(playwright);
    const step = ci.slice(ci.lastIndexOf("- name:", memory), memory + 300);
    expect(step).toMatch(/if: failure\(\)/);
    expect(step).toMatch(/sudo dmesg/);
    expect(step).toMatch(/grep -iE[^\n]*oom/i);
  });

  // 2026-11-05: the repository went public, public runners have 4 vCPUs instead of 2, and Playwright's default (half the CPUs) started
  // 2 workers. The suite was built and timed on 1 worker in CI (one Auth per-IP sign-in bucket, shared fixtures), and with 2 a kitchen
  // test hung for its full 5 minutes (run 42080729454). CI stays on 1 worker; locally the default stands.
  it("runs one worker in CI and leaves the local default alone", () => {
    const source = readFileSync(new URL("../../playwright.config.ts", import.meta.url), "utf8");
    expect(source).toMatch(/\n {2}workers: process\.env\.CI \? 1 : undefined,\n/);
  });
});
