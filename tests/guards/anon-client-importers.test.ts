import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Reservations plan §5 B7, ADR-032 decision 1: the cookie-less anon client calls the five gated anon functions, and only the public reservation
// services may import it. A staff route that imported it would run as `anon` on a signed-in phone and skip RLS-by-role. Tests may import it (to mock it).
const ANON = "src/lib/supabase/anon";
const ALLOWED_PREFIX = "src/server/reservations/public/";

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*)["']([^"']+)["']/g;
const IDENTIFIER = /\bcreateSupabaseAnonClient\b/;

/** True when `source`, living at `file` (repo-relative), imports the anon client module by any style or names its export. */
export function usesAnonClient(source: string, file: string): boolean {
  const imports = [...source.matchAll(SPECIFIER)].some((match) => {
    let target = match[1] ?? "";
    if (target.startsWith("@/")) target = `src/${target.slice(2)}`;
    else if (target.startsWith(".")) target = normalize(join(dirname(file), target));
    else return false;
    return target.replace(/\.[cm]?[jt]sx?$/, "") === ANON;
  });
  return imports || IDENTIFIER.test(source);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

describe("only the public reservation services use the anon client", () => {
  it("the scanner recognises every import style (self-test)", () => {
    for (const [code, file] of [
      ['import { a } from "@/lib/supabase/anon";', "src/app/y.ts"],
      ['import { a } from "./anon";', "src/lib/supabase/z.ts"],
      ['import { a } from "../../lib/supabase/anon.ts";', "src/server/x/z.ts"],
      ['const m = await import("@/lib/supabase/anon");', "src/app/y.ts"],
      ['export { a } from "./anon";', "src/lib/supabase/z.ts"],
      ["const c = createSupabaseAnonClient();", "src/app/y.ts"],
    ] as const) {
      expect(usesAnonClient(code, file), code).toBe(true);
    }
    for (const [code, file] of [
      ['import { a } from "./anon";', "src/server/other/z.ts"],
      ['import { a } from "@/lib/supabase/server";', "src/app/y.ts"],
      ['import { a } from "@/lib/supabase/anonymous";', "src/app/y.ts"],
    ] as const) {
      expect(usesAnonClient(code, file), code).toBe(false);
    }
  });

  it("finds no other file under src/ that uses it", () => {
    const root = process.cwd();
    const offenders = sourceFiles(join(root, "src"))
      .map((file) => relative(root, file))
      .filter((path) => path !== `${ANON}.ts` && !path.startsWith(ALLOWED_PREFIX))
      .filter((path) => usesAnonClient(readFileSync(join(root, path), "utf8"), path));
    expect(offenders).toEqual([]);
  });

  it("the module and its one importer exist, so a rename cannot silently empty the guard", () => {
    expect(() => readFileSync(join(process.cwd(), `${ANON}.ts`), "utf8")).not.toThrow();
    const users = sourceFiles(join(process.cwd(), ALLOWED_PREFIX.slice(0, -1))).filter((f) =>
      usesAnonClient(readFileSync(f, "utf8"), relative(process.cwd(), f)),
    );
    expect(users.length).toBeGreaterThan(0);
  });
});
