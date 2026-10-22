import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// next.config.ts is compiled on its own by Next.js, which does not resolve the "@/" alias. Every
// module it loads (transitively) must therefore use relative imports for runtime code.
const ROOT = process.cwd();
const IMPORT =
  /^\s*(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function resolveRelative(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, join(base, "index.ts"), base]) {
    if (existsSync(candidate) && /\.ts$/.test(candidate)) return candidate;
  }
  return null;
}

/** Runtime `@/` imports found in next.config.ts and the local modules it loads. */
export function aliasImports(source: string): string[] {
  return [...source.matchAll(IMPORT)]
    .filter((m) => !m[2] && (m[3] ?? m[4] ?? "").startsWith("@/"))
    .map((m) => (m[3] ?? m[4]) as string);
}

function walk(entry: string, seen = new Set<string>()): { file: string; spec: string }[] {
  if (seen.has(entry)) return [];
  seen.add(entry);
  const source = readFileSync(entry, "utf8");
  const offences = aliasImports(source).map((spec) => ({ file: entry, spec }));
  for (const m of source.matchAll(IMPORT)) {
    const spec = m[3] ?? m[4];
    if (m[2] || !spec?.startsWith(".")) continue;
    const next = resolveRelative(entry, spec);
    if (next) offences.push(...walk(next, seen));
  }
  return offences;
}

describe("next.config.ts imports", () => {
  it("the scanner flags runtime alias imports but not type-only ones (self-test)", () => {
    expect(aliasImports('import { a } from "@/x";')).toEqual(["@/x"]);
    expect(aliasImports('import type { A } from "@/x";')).toEqual([]);
    expect(aliasImports('import { a } from "./x";')).toEqual([]);
  });

  it("no module loaded by next.config.ts uses an @/ alias", () => {
    const offences = walk(join(ROOT, "next.config.ts")).map(
      ({ file, spec }) => `${file.replace(ROOT + "/", "")}: ${spec}`,
    );
    expect(offences).toEqual([]);
  });
});
