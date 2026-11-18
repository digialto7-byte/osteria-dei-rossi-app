import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Lead ruling 2026-11-18 (Rule B): no silent settings defaults. The only sanctioned default is the
// formatter's, before the store is filled (first paint, server render): FIRST_PAINT_VENUE_SETTINGS,
// defined in src/lib/venue/settings.ts and read only by src/lib/venue/current.ts.
const ALLOWED = new Set(["src/lib/venue/settings.ts", "src/lib/venue/current.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("first-paint settings defaults", () => {
  it("are named in exactly one module and used by exactly one other", () => {
    const root = process.cwd();
    const users = files(join(root, "src"))
      .filter((f) => readFileSync(f, "utf8").includes("FIRST_PAINT_VENUE_SETTINGS"))
      .map((f) => relative(root, f));
    expect(users.sort()).toEqual([...ALLOWED].sort());
  });

  it("no other default-settings constant exists", () => {
    const root = process.cwd();
    const hits = files(join(root, "src")).filter((f) =>
      /DEFAULT_VENUE_SETTINGS/.test(readFileSync(f, "utf8")),
    );
    expect(hits).toEqual([]);
  });
});
