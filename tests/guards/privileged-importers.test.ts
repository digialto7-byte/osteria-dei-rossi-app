import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md rule 2 / ADR-010: the secret-key surface of staff PIN login is the module
// src/server/staff-auth/privileged.ts, and exactly these files may import it: the three services
// behind /api/auth/pin, /api/devices/enrol and /api/users*, and the /api/auth/device route.
// admin-client-importers.test.ts guards the admin client; this one guards the exception itself.
const PRIVILEGED = "src/server/staff-auth/privileged";
const ALLOWED_IMPORTERS = [
  "src/app/api/auth/device/route.ts",
  "src/server/staff-auth/enrolment.ts",
  "src/server/staff-auth/pin-login.ts",
  "src/server/staff-auth/staff.ts",
];

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*)["']([^"']+)["']/g;

/** True when `source`, living at `file` (repo-relative), imports the privileged module by any style. */
export function importsPrivileged(source: string, file: string): boolean {
  return [...source.matchAll(SPECIFIER)].some((match) => {
    let target = match[1] ?? "";
    if (target.startsWith("@/")) target = `src/${target.slice(2)}`;
    else if (target.startsWith(".")) target = normalize(join(dirname(file), target));
    else return false;
    return target.replace(/\.[cm]?[jt]sx?$/, "") === PRIVILEGED;
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

describe("only four files import the privileged staff-auth module", () => {
  it("the scanner recognises every import style (self-test)", () => {
    const from = "src/server/staff-auth/x.ts";
    for (const [code, file] of [
      ['import { a } from "@/server/staff-auth/privileged";', "src/app/y.ts"],
      ['import { a } from "./privileged";', from],
      ['import { a } from "./privileged.ts";', from],
      ['import { a } from "../staff-auth/privileged";', "src/server/other/z.ts"],
      ['const m = await import("@/server/staff-auth/privileged");', "src/app/y.ts"],
      ['const m = require("./privileged");', from],
      ['export { a } from "./privileged";', from],
      ['import type { A } from "./privileged.js";', from],
    ] as const) {
      expect(importsPrivileged(code, file), code).toBe(true);
    }
    for (const [code, file] of [
      ['import { a } from "./privileged";', "src/server/other/z.ts"],
      ['import { a } from "@/server/staff-auth/privileged-extra";', "src/app/y.ts"],
      ['import { a } from "@/server/staff-auth/rpc";', "src/app/y.ts"],
      ['import { a } from "other-package/privileged";', "src/app/y.ts"],
    ] as const) {
      expect(importsPrivileged(code, file), code).toBe(false);
    }
  });

  it("finds no other file under src/ or scripts/ that imports it", () => {
    const root = process.cwd();
    const importers = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "scripts"))]
      .map((file) => relative(root, file))
      .filter((path) => path !== `${PRIVILEGED}.ts`)
      .filter((path) => importsPrivileged(readFileSync(join(root, path), "utf8"), path));
    expect(importers.sort()).toEqual(ALLOWED_IMPORTERS);
  });

  it("the module exists, so a rename cannot silently empty the guard", () => {
    expect(() => readFileSync(join(process.cwd(), `${PRIVILEGED}.ts`), "utf8")).not.toThrow();
  });
});
