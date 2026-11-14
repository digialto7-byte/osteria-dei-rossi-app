import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "@/lib/design/tokens";

// UX quick wins plan §3.2 and §5 (D1): the quick wins change layout, placement, wording and flow only. No migration, no new design
// token, no new dependency (the dependency list is pinned by no-new-deps.test.ts). Adding any of them needs a plan change.
// The quick wins added none: the newest one is the admin-always-MFA fix (FD31), which is not a quick win. A later migration needs this pin moved on purpose.
// P2-2 (20261203*) moves it on purpose to its own last migration so far; each P2-2 migration moves it forward.
// P2-7 (20261204*) moves it on purpose to its own last migration so far; each P2-7 migration moves it forward.
const NEWEST_MIGRATION = "20261204100000_xml_invoice_columns.sql";

describe("UX quick wins add no migration and no token", () => {
  it("keeps the newest migration", () => {
    const files = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.at(-1)).toBe(NEWEST_MIGRATION);
  });

  const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
  const theme = css.slice(css.indexOf("@theme {"), css.indexOf("@theme inline"));

  it("declares in @theme exactly the colour tokens of tokens.ts", () => {
    const names = [...theme.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]).sort();
    expect(names).toEqual([...COLOR_TOKENS].sort());
  });

  it("declares no spacing or text token besides the existing --spacing-tap", () => {
    const names = [...theme.matchAll(/--(spacing|text)-([a-z0-9-]+):/g)].map(
      (m) => `${m[1]}-${m[2]}`,
    );
    expect(names).toEqual(["spacing-tap"]);
  });
});
