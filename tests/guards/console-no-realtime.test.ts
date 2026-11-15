import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP3 step 20 (plan section 3.10): console sessions never open Realtime. The console has no browser Supabase client (its sessions are HttpOnly), server code
// reaches Supabase only through withApi's route client, and nothing in the console mounts the service worker. These are source scans over the console's
// directories, each only when it exists, so the guard covers the screens (step 18) as soon as their files land.
// The console host's page CSP (connect-src 'self', no wss:) is pinned by step 16 in tests/proxy-console-host.test.ts ("the page policy is
// connect-src 'self' with no wss:"), where the proxy builds it.
const ROOT = new URL("../../", import.meta.url).pathname;
const CONSOLE_DIRS = [
  "src/app/(platform)",
  "src/server/platform",
  "src/components/console",
  "src/lib/platform",
];

// Any import of a Supabase package or of one of src/lib/supabase/* (admin, anon, verifier, server, cookies and proxy all wrap a client), in any spelling:
// named, default, namespace, side-effect, re-export, dynamic import() or require().
const SPEC = String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']`;
const FORBIDDEN: [string, RegExp][] = [
  ["createBrowserClient", /createBrowserClient/],
  ["an import of @supabase/*", new RegExp(`${SPEC}@supabase/`)],
  [
    "an import of src/lib/supabase/*",
    new RegExp(`${SPEC}(?:@/|(?:\\.\\.?/)+(?:src/)?)lib/supabase(?:/|["'])`),
  ],
  [".channel(", /\.channel\s*\(/],
  ["realtime", /realtime/i],
  ["RealtimeChannel", /RealtimeChannel/],
];

/** The forbidden things one source text contains, by name. */
function scan(text: string): string[] {
  return FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

const SOURCE_FILE = /\.(ts|tsx|js|mjs|cjs|jsx)$/;

function files(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

const sources = (dir: string) => files(join(ROOT, dir), SOURCE_FILE);

describe("the scanner", () => {
  it("flags the fixture file that calls .channel( and names the rest", () => {
    const fixture = readFileSync(
      new URL("./fixtures/realtime-client.ts.txt", import.meta.url),
      "utf8",
    );
    expect(scan(fixture)).toEqual([
      "createBrowserClient",
      "an import of @supabase/*",
      ".channel(",
      "realtime",
      "RealtimeChannel",
    ]);
  });

  it.each([
    ['import * as supabase from "@supabase/supabase-js";', "an import of @supabase/*"],
    ['import supabase from "@supabase/ssr";', "an import of @supabase/*"],
    ['import "@supabase/supabase-js";', "an import of @supabase/*"],
    ['export * from "@supabase/supabase-js";', "an import of @supabase/*"],
    ['const m = await import("@supabase/supabase-js");', "an import of @supabase/*"],
    ['const m = require("@supabase/ssr");', "an import of @supabase/*"],
    [
      'import { createSupabaseAnonClient } from "@/lib/supabase/anon";',
      "an import of src/lib/supabase/*",
    ],
    [
      'import { createSupabaseAdminClient } from "@/lib/supabase/admin";',
      "an import of src/lib/supabase/*",
    ],
    [
      'import { createSupabaseServerClient } from "@/lib/supabase/server";',
      "an import of src/lib/supabase/*",
    ],
    ['import { v } from "@/lib/supabase/verifier";', "an import of src/lib/supabase/*"],
    ['const m = await import("@/lib/supabase/anon");', "an import of src/lib/supabase/*"],
    ['import { a } from "../../lib/supabase/anon";', "an import of src/lib/supabase/*"],
    ["const c = client.channel('x');", ".channel("],
  ])("flags %s", (text, name) => {
    expect(scan(text)).toEqual([name]);
  });

  it("does not flag a path that only looks similar", () => {
    expect(scan('import { x } from "@/lib/supabase-notes";')).toEqual([]);
  });

  it("scans .js, .mjs and .cjs files as well as .ts and .tsx", () => {
    const dir = join(ROOT, "tests/guards/fixtures");
    expect(files(dir, SOURCE_FILE).map((f) => f.slice(dir.length + 1))).toEqual([]);
    for (const name of ["a.ts", "a.tsx", "a.js", "a.mjs", "a.cjs", "a.jsx"])
      expect(SOURCE_FILE.test(name), name).toBe(true);
    expect(SOURCE_FILE.test("a.ts.txt")).toBe(false);
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
