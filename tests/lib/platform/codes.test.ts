import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_ORIGINS,
  PLATFORM_NOTICE_KINDS,
} from "@/lib/platform/codes";

// SP3 step 21a (docs/plans sp3 section 3.1.3 and 3.4.2): the code lists the console and the database share.
describe("platform codes", () => {
  it("PLATFORM_AUDIT_ACTIONS is exactly the ten codes of the plan", () => {
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
    ]);
  });

  it("PLATFORM_NOTICE_KINDS is ['subprocessor']", () => {
    expect([...PLATFORM_NOTICE_KINDS]).toEqual(["subprocessor"]);
  });

  it("PLATFORM_AUDIT_ORIGINS is ['console','script']", () => {
    expect([...PLATFORM_AUDIT_ORIGINS]).toEqual(["console", "script"]);
  });

  it("is client-importable: the platform modules import nothing from the server or Supabase", () => {
    for (const file of ["codes.ts", "api.ts"]) {
      const text = readFileSync(
        new URL(`../../../src/lib/platform/${file}`, import.meta.url),
        "utf8",
      );
      const imports = [...text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/(^|\/)server(\/|$)|supabase/);
      }
    }
  });
});
