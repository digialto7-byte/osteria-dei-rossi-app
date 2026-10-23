import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ADR-010 / CLAUDE.md rule 2: outside cron and scripts, exactly one src/ module may use the
// secret-key admin client: src/server/staff-auth/privileged.ts. ESLint enforces it per file; this
// scan fails the build on any other importer, whatever the import style, so a lint config edit
// alone cannot widen the exception.
const ALLOWED = [
  "src/lib/supabase/admin.ts", // defines the client
  "src/server/staff-auth/privileged.ts", // the one audited exception
];
const ALLOWED_PREFIXES = ["src/app/api/cron/", "src/server/cron/"];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
const ADMIN_MODULE = /(^|\/)admin(\.[cm]?[jt]s)?$/;
const ADMIN_IDENTIFIER = /\b(createSupabaseAdminClient|readSupabaseSecretKey)\b/;

/** True when the source imports the admin client module or names one of its exports. */
export function usesAdminClient(source: string): boolean {
  const specifiers = [...source.matchAll(SPECIFIER)].map((match) => match[1] ?? "");
  const importsModule = specifiers.some(
    (specifier) => ADMIN_MODULE.test(specifier) && /supabase\/admin|^\.\.?\/admin/.test(specifier),
  );
  return importsModule || ADMIN_IDENTIFIER.test(source);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const isAllowed = (path: string) =>
  ALLOWED.includes(path) || ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));

describe("only the audited modules use the admin client", () => {
  it("the scanner recognises every import style (self-test)", () => {
    for (const code of [
      'import { c } from "@/lib/supabase/admin";',
      'import { c } from "../../lib/supabase/admin.ts";',
      'const m = await import("./admin");',
      'const m = require("@/lib/supabase/admin");',
      'import type { X } from "./admin.js";',
      "const c = createSupabaseAdminClient();",
      "const k = readSupabaseSecretKey();",
    ]) {
      expect(usesAdminClient(code), code).toBe(true);
    }
    for (const code of [
      'import { createClient } from "@supabase/supabase-js";',
      'import { x } from "@/server/master/suppliers";',
      'import { y } from "./administrator";',
    ]) {
      expect(usesAdminClient(code), code).toBe(false);
    }
  });

  it("finds no other non-cron file under src/ that uses it", () => {
    const root = process.cwd();
    const offenders = sourceFiles(join(root, "src"))
      .map((file) => relative(root, file))
      .filter((path) => !isAllowed(path))
      .filter((path) => usesAdminClient(readFileSync(join(root, path), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the allow-list files exist, so a rename cannot silently empty the guard", () => {
    for (const path of ALLOWED) {
      expect(() => readFileSync(join(process.cwd(), path), "utf8"), path).not.toThrow();
    }
  });
});
