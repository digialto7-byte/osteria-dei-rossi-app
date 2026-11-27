import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_ORIGINS,
  PLATFORM_NOTICE_KINDS,
} from "@/lib/platform/codes";

// SP3 step 21a (docs/plans sp3 section 3.1.3 and 3.4.2): the code lists the console and the database share.
const ALLOWED_IMPORTS = new Set(["zod", "./codes", "./api"]);
/** Every module specifier a source text imports, re-exports, requires or imports dynamically, that is not on the allowlist. */
function disallowedImports(text: string): string[] {
  const specs = [
    ...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g),
  ].map((m) => m[1] ?? "");
  return specs.filter((spec) => !ALLOWED_IMPORTS.has(spec));
}

describe("platform codes", () => {
  // re-pinned on purpose by SP3 (PR 1 add-owner, lead 2026-11-27; was ten codes): script.add_owner.
  it("PLATFORM_AUDIT_ACTIONS is exactly the eleven codes of the plan", () => {
    expect([...PLATFORM_AUDIT_ACTIONS]).toEqual([
      "platform_admin.bootstrapped",
      "platform_admin.factor_enrolled",
      "console.entered",
      "console.left",
      "console.tenant_opened",
      "notice.created",
      "notice.tenant_notified",
      "script.create_tenant",
      "script.mfa_reset",
      "script.set_mfa_enforcement",
      "script.add_owner",
    ]);
  });

  it("PLATFORM_NOTICE_KINDS is ['subprocessor']", () => {
    expect([...PLATFORM_NOTICE_KINDS]).toEqual(["subprocessor"]);
  });

  it("PLATFORM_AUDIT_ORIGINS is ['console','script']", () => {
    expect([...PLATFORM_AUDIT_ORIGINS]).toEqual(["console", "script"]);
  });

  it("is client-importable: the platform modules import only zod, ./codes and ./api", () => {
    for (const file of ["codes.ts", "api.ts"]) {
      const text = readFileSync(
        new URL(`../../../src/lib/platform/${file}`, import.meta.url),
        "utf8",
      );
      expect(disallowedImports(text), file).toEqual([]);
    }
  });

  it.each([
    'import "server-only";',
    'import { x } from "node:fs";',
    'import { headers } from "next/headers";',
    'import { readPublicEnv } from "@/lib/env";',
    'import { c } from "@/server/platform/output";',
    'import { c } from "@/lib/supabase/anon";',
    'const m = await import("node:path");',
    'const m = require("fs");',
    'export * from "../../server/x";',
  ])("the allowlist catches %s", (line) => {
    expect(disallowedImports(line)).toHaveLength(1);
  });

  it("the allowlist passes zod and the two sibling modules", () => {
    expect(
      disallowedImports(
        'import { z } from "zod";\nimport { a } from "./codes";\nexport * from "./api";',
      ),
    ).toEqual([]);
  });
});
