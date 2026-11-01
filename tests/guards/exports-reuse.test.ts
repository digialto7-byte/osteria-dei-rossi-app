import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M24 step 4 (ADR-027): the exports are a rendering of the JSON services. Nothing under src/server/exports/ or src/app/api/exports/ may talk to the database itself (no
// .rpc( call, no .from( query, no Supabase value import: the services receive the session client) or mark a response for the service worker's cache.
const ROOTS = [
  join(__dirname, "../../src/server/exports"),
  join(__dirname, "../../src/app/api/exports"),
];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });

/** Source without comments, so prose that names the rules does not trip them. */
const strip = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
const code = (file: string) => strip(readFileSync(file, "utf8"));

const RULES: Array<[string, RegExp]> = [
  ["calls .rpc(", /\.rpc\s*\(/],
  ["calls .from(", /(?<!\bArray)\.from\s*\(/],
  [
    "imports a value from @supabase/supabase-js",
    /^\s*import\s+(?!type\b)[^;]*?from\s+["']@supabase\/supabase-js["']/m,
  ],
  ["imports from @/lib/supabase/", /from\s+["']@\/lib\/supabase\//],
  ["imports @/lib/api/offline-cache", /["']@\/lib\/api\/offline-cache["']/],
  ["reads the secret key", /SUPABASE_SECRET_KEY|SERVICE_ROLE/],
];

describe("src/server/exports reuses the services and never queries", () => {
  const all = ROOTS.flatMap(files);

  it("finds the export files", () => {
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(all.some((f) => f.includes("/src/app/api/exports/"))).toBe(true);
  });

  for (const [name, pattern] of RULES) {
    it(`no file ${name}`, () => {
      expect(
        all.filter((f) => pattern.test(code(f))).map((f) => f.replace(/^.*\/src\//, "")),
      ).toEqual([]);
    });
  }

  it("the rules would catch a violation, and comments are ignored (self-test)", () => {
    const sample =
      'const x = await supabase.rpc("kpi_report", {});\nimport a from "@/lib/supabase/server";';
    expect(RULES[0]![1].test(strip(sample))).toBe(true);
    expect(RULES[3]![1].test(strip(sample))).toBe(true);
    const from = RULES[1]![1];
    expect(from.test('supabase.from("menu_item").select()')).toBe(true);
    expect(from.test("client.from(table)")).toBe(true);
    expect(from.test("Array.from({ length: 24 }, f)")).toBe(false);
    const value = RULES[2]![1];
    expect(value.test('import { createClient } from "@supabase/supabase-js";')).toBe(true);
    expect(value.test('import { type SupabaseClient } from "@supabase/supabase-js";')).toBe(true);
    expect(value.test('import type { SupabaseClient } from "@supabase/supabase-js";')).toBe(false);
    expect(RULES[0]![1].test(strip("// a comment about .rpc(\n/* and .rpc( */ const a = 1;"))).toBe(
      false,
    );
  });
});
