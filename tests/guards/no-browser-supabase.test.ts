import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ADR-028: connect-src is 'self' because the browser never calls Supabase; a browser client would need its origin there.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("no browser Supabase client in src/", () => {
  it("no file uses createBrowserClient", () => {
    const all = files(new URL("../../src", import.meta.url).pathname);
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((f) => readFileSync(f, "utf8").includes("createBrowserClient"))).toEqual([]);
  });
});
