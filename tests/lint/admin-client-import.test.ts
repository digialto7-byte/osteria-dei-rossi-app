import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// M0 acceptance test 11: lint (same config as `npm run lint`) rejects the secret-key admin
// client outside cron services and scripts.
const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? message.message);
}

const ALIAS_IMPORT =
  'import { createSupabaseAdminClient } from "@/lib/supabase/admin";\nexport const c = createSupabaseAdminClient;\n';
const RELATIVE_IMPORT =
  'import { createSupabaseAdminClient } from "../../lib/supabase/admin";\nexport const c = createSupabaseAdminClient;\n';
const KEY_READ = "export const key = process.env.SUPABASE_SECRET_KEY;\n";

describe("secret-key admin client lint guard", () => {
  it.each([
    ["a component", "src/components/Bad.tsx"],
    ["a user-facing route", "src/app/api/me/route.ts"],
    ["a page", "src/app/page.tsx"],
    ["a service", "src/server/invoices/approve.ts"],
  ])("fails when imported from %s", async (_label, filePath) => {
    expect(await ruleIds(ALIAS_IMPORT, filePath)).toContain("no-restricted-imports");
  });

  it("fails on a relative import too", async () => {
    expect(await ruleIds(RELATIVE_IMPORT, "src/app/api/me/route.ts")).toContain(
      "no-restricted-imports",
    );
  });

  it.each([
    ["a cron route", "src/app/api/cron/extract/route.ts"],
    ["a cron service", "src/server/cron/extract.ts"],
    ["a script", "scripts/create-tenant.ts"],
  ])("passes when imported from %s", async (_label, filePath) => {
    expect(await ruleIds(ALIAS_IMPORT, filePath)).not.toContain("no-restricted-imports");
  });

  it("fails on a dynamic import or an explicit .ts specifier", async () => {
    expect(
      await ruleIds(
        'export const load = () => import("@/lib/supabase/admin");\n',
        "src/app/page.tsx",
      ),
    ).toContain("no-restricted-syntax");
    expect(
      await ruleIds(
        'import { createSupabaseAdminClient } from "@/lib/supabase/admin.ts";\nexport const c = createSupabaseAdminClient;\n',
        "src/app/api/me/route.ts",
      ),
    ).toContain("no-restricted-imports");
  });

  it("fails when the secret key is destructured from process.env", async () => {
    expect(
      await ruleIds(
        "const { SUPABASE_SECRET_KEY } = process.env;\nexport const k = SUPABASE_SECRET_KEY;\n",
        "src/lib/x.ts",
      ),
    ).toContain("no-restricted-syntax");
  });

  it("fails when the secret key is read outside the admin module", async () => {
    expect(await ruleIds(KEY_READ, "src/lib/anything.ts")).toContain("no-restricted-syntax");
    expect(await ruleIds(KEY_READ, "src/lib/supabase/admin.ts")).not.toContain(
      "no-restricted-syntax",
    );
  });
});
