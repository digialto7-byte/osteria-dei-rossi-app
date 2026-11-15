import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SP3 step 16, plan §3.5 Q6: under the console host's rewrite (/<p> to /console/<p>), usePathname() is the visible path in a dynamically
// rendered page and the internal one in a prerendered page (a hydration mismatch). Every page is dynamic because the root layout reads
// headers() for the nonce (ADR-028); this guard fails if that goes, or if a console page opts into static rendering.
const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** What makes a Next.js App Router file static or cached, as written in the source. */
const STATIC_SIGNALS: [string, RegExp][] = [
  ["dynamic = force-static", /export\s+const\s+dynamic\s*=\s*["']force-static["']/],
  ["dynamic = error", /export\s+const\s+dynamic\s*=\s*["']error["']/],
  ["revalidate", /export\s+const\s+revalidate\b/],
  ["generateStaticParams", /\bgenerateStaticParams\b/],
  ["use cache", /^\s*["']use cache/m],
];

export function staticSignals(source: string): string[] {
  return STATIC_SIGNALS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

function consoleFiles(): string[] {
  const dir = new URL("src/app/(platform)/", ROOT);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

describe("console pages are rendered per request (Q6)", () => {
  it("the root layout reads headers() for the nonce, which makes every page dynamic", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('import { headers } from "next/headers"');
    expect(layout).toMatch(/await headers\(\)/);
  });

  it("no file under src/app/(platform)/ opts into static rendering or caching (vacuous while the folder is empty)", () => {
    for (const file of consoleFiles()) {
      expect(staticSignals(readFileSync(file, "utf8")), file).toEqual([]);
    }
  });

  it("the check catches each static signal (so it is not vacuous when pages arrive)", () => {
    expect(staticSignals('export const dynamic = "force-static";')).toEqual([
      "dynamic = force-static",
    ]);
    expect(staticSignals("export const dynamic = 'error'")).toEqual(["dynamic = error"]);
    expect(staticSignals("export const revalidate = 60;")).toEqual(["revalidate"]);
    expect(staticSignals("export async function generateStaticParams() {}")).toEqual([
      "generateStaticParams",
    ]);
    expect(staticSignals('"use cache";\nexport default async function Page() {}')).toEqual([
      "use cache",
    ]);
    expect(staticSignals('export const dynamic = "force-dynamic";')).toEqual([]);
  });
});
