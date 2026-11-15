import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP3 step 20 (plan section 3.10): console sessions never open Realtime. The console has no browser Supabase client (its sessions are HttpOnly), server code
// reaches Supabase only through withApi's route client, and nothing in the console mounts the service worker. These are source scans over the console's
// directories, each only when it exists, so the guard covers the screens (step 18) as soon as their files land.
// Not here yet: the console host's page CSP keeps connect-src 'self' and has no wss: (needs src/proxy.ts host rules, step 16; added to
// tests/proxy-console-host.test.ts then).
const ROOT = new URL("../../", import.meta.url).pathname;
const CONSOLE_DIRS = [
  "src/app/(platform)",
  "src/server/platform",
  "src/components/console",
  "src/lib/platform",
];

const FORBIDDEN: [string, RegExp][] = [
  ["createBrowserClient", /createBrowserClient/],
  [
    "a createClient import from @supabase/supabase-js",
    /import\s*(?:type\s*)?\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*["']@supabase\/supabase-js["']/,
  ],
  [".channel(", /\.channel\s*\(/],
  ["realtime", /realtime/i],
  ["RealtimeChannel", /RealtimeChannel/],
];

/** The forbidden things one source text contains, by name. */
function scan(text: string): string[] {
  return FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function files(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

const sources = (dir: string) => files(join(ROOT, dir), /\.(ts|tsx)$/);

describe("the scanner", () => {
  it("flags the fixture file that calls .channel( and names the rest", () => {
    const fixture = readFileSync(
      new URL("./fixtures/realtime-client.ts.txt", import.meta.url),
      "utf8",
    );
    expect(scan(fixture)).toEqual([
      "createBrowserClient",
      "a createClient import from @supabase/supabase-js",
      ".channel(",
      "realtime",
      "RealtimeChannel",
    ]);
  });

  it("passes a plain server file", () => {
    expect(scan('import { z } from "zod";\nexport const a = z.string();\n')).toEqual([]);
  });
});

describe("console sessions never open Realtime", () => {
  it.each(CONSOLE_DIRS)("%s holds no browser client, no channel and no realtime", (dir) => {
    const offenders = sources(dir).flatMap((file) =>
      scan(readFileSync(file, "utf8")).map((name) => `${file.slice(ROOT.length)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no .channel( anywhere in src/", () => {
    const all = sources("src");
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((f) => /\.channel\s*\(/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("no file under src/app/(platform)/ imports the service worker code (@/pwa/*)", () => {
    const offenders = sources("src/app/(platform)").filter((f) =>
      /from\s*["']@\/pwa\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
