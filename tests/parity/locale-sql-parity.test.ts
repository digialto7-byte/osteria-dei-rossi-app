// Keeps LOCALES (src/lib/i18n/locale.ts) in step with the SQL of SP1 step 7 (migration 20261206200400_tenant_locale_settings.sql): the CHECK on
// tenant.default_locale and the list public.set_tenant_settings validates a patch against. A third language is a change in all three places.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/locale";

const sql = readFileSync(
  new URL("../../supabase/migrations/20261206200400_tenant_locale_settings.sql", import.meta.url),
  "utf8",
);
const found = (name: string, pattern: RegExp) => {
  const match = pattern.exec(sql);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};
const words = (list: string) => [...list.matchAll(/'(\w+)'/g)].map((x) => x[1]);

describe("LOCALES match the migration", () => {
  it("the CHECK tenant_default_locale_check lists exactly LOCALES, in order", () => {
    const m = found(
      "check",
      /constraint tenant_default_locale_check check \(default_locale in \(([^)]*)\)\)/,
    );
    expect(words(m[1]!)).toEqual([...LOCALES]);
  });

  it("the column defaults to the first locale", () => {
    const m = found("default", /add column default_locale text not null default '(\w+)'/);
    expect(m[1]).toBe(LOCALES[0]);
  });

  it("set_tenant_settings validates a locale against exactly LOCALES, in order", () => {
    const m = found("validation", /v_locale <> all \(array\[([^\]]*)\]\)/);
    expect(words(m[1]!)).toEqual([...LOCALES]);
  });
});
