import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";

// Every Chromium e2e run uses the full Chromium build in new headless mode (channel "chromium"), never Playwright's default
// chromium_headless_shell. headless_shell-1194 (Playwright 1.56.1) segfaulted in BrowserContext.close after a long browser life:
// `segfault at 1b0 … in headless_shell[2705ee1,…]` in #140 (run 43682851653) and #169 (run 44290874533), the second after #152 had
// fixed the teardown order. Probe #172 (run 44294758594) ran the crashing spec 60 times on each binary: 60/60 on both, so this is
// not a statistical proof, but the crash site is in a binary we no longer launch (lead, 2026-11-18, option a). If the crash ever
// shows on the full binary, the next step is a Playwright bump (option c). See docs/handoff/builder.md §5.
const projects = config.projects ?? [];
const E2E_DIR = join(__dirname, "..", "..", "e2e");

function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? specFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("e2e Chromium channel", () => {
  it("every Chromium project runs channel chromium, and the WebKit project sets no channel", () => {
    const chromium = projects.filter(
      (p) => (p.use?.defaultBrowserType ?? "chromium") === "chromium",
    );
    expect(chromium.map((p) => p.name)).toEqual(["phone", "laptop", "perf-4g", "service-sim"]);
    for (const project of chromium) expect(project.use?.channel, project.name).toBe("chromium");
    const webkit = projects.find((p) => p.name === "phone-webkit")!;
    expect(webkit.use?.defaultBrowserType).toBe("webkit");
    expect(webkit.use?.channel).toBeUndefined();
  });

  it("the top-level use sets no channel (each project states its own)", () => {
    expect(config.use?.channel).toBeUndefined();
  });

  it("a spec that launches its own Chromium passes channel chromium too", () => {
    const launches = specFiles(E2E_DIR).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/chromium\.launch\(([^)]*)\)/g)].map((m) => ({
        file: relative(E2E_DIR, file),
        args: m[1],
      }));
    });
    expect(launches.length).toBeGreaterThan(0);
    for (const { file, args } of launches) expect(args, file).toMatch(/channel:\s*"chromium"/);
  });
});
