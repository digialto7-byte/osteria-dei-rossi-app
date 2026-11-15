import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SP3 step 16: the manifest and the service worker skip the proxy (they must reach signed-out browsers), so the console, which shares the
// root layout, must neither link the manifest nor register the worker. The manifest link is in the venue layouts' metadata only.
const APP = join(process.cwd(), "src/app");
const read = (path: string) => readFileSync(path, "utf8");

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

/** Files whose source names a manifest in metadata (`manifest:`) or is a root metadata manifest file. */
function linksManifest(file: string, source: string): boolean {
  return /\bmanifest\s*:/.test(source) || /(^|[\\/])manifest\.(ts|js)$/.test(file);
}

/** Imports of the service-worker code or of the venue shell, which registers it. */
function importsPwa(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)]
    .map((m) => m[1] ?? m[2]!)
    .filter(
      (spec) => /^@\/pwa(\/|$)/.test(spec) || /app-shell/.test(spec) || /\(owner\)/.test(spec),
    );
}

describe("the manifest link is under the venue layouts only", () => {
  const VENUE_LAYOUTS = ["(owner)/layout.tsx", "(public)/layout.tsx"].map((f) => join(APP, f));

  it("the root layout's metadata has no manifest, and there is no root manifest file", () => {
    expect(linksManifest(join(APP, "layout.tsx"), read(join(APP, "layout.tsx")))).toBe(false);
    expect(existsSync(join(APP, "manifest.ts"))).toBe(false);
  });

  it("each venue layout links /manifest.webmanifest in its metadata", () => {
    for (const layout of VENUE_LAYOUTS) {
      expect(read(layout), layout).toMatch(
        /export const metadata: Metadata = \{\s*manifest: "\/manifest\.webmanifest",?\s*\}/,
      );
    }
  });

  it("no other file under src/app (the console's included) links a manifest, except the route that serves it", () => {
    const linking = filesUnder(APP)
      .filter((f) => !f.endsWith(join("manifest.webmanifest", "route.ts")))
      .filter((f) => linksManifest(f, read(f)))
      .map((f) => relative(APP, f))
      .sort();
    expect(linking).toEqual(["(owner)/layout.tsx", "(public)/layout.tsx"]);
  });

  it("every route group with pages is a venue group or absent: a new group must be decided here", () => {
    const groups = readdirSync(APP, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\(.+\)$/.test(e.name))
      .map((e) => e.name)
      .sort();
    expect(groups.filter((g) => !["(owner)", "(public)", "(platform)"].includes(g))).toEqual([]);
  });

  it("the detector sees a metadata manifest and a root manifest file", () => {
    expect(linksManifest("x/layout.tsx", 'export const metadata = { manifest: "/m" }')).toBe(true);
    expect(linksManifest("src/app/manifest.ts", "")).toBe(true);
    expect(linksManifest("x/layout.tsx", "export const metadata = { title: 'a' }")).toBe(false);
  });
});

describe("the console page tree never registers the service worker", () => {
  it("no file under src/app/(platform)/ imports @/pwa/* or the venue app shell (vacuous while the folder is empty)", () => {
    for (const file of filesUnder(join(APP, "(platform)"))) {
      expect(importsPwa(read(file)), file).toEqual([]);
    }
  });

  it("the root layout imports nothing from @/pwa", () => {
    expect(importsPwa(read(join(APP, "layout.tsx")))).toEqual([]);
  });

  it("the scanner catches each import form", () => {
    expect(importsPwa('import { x } from "@/pwa/use-outbox";')).toEqual(["@/pwa/use-outbox"]);
    expect(importsPwa("import { x } from '@/pwa';")).toEqual(["@/pwa"]);
    expect(importsPwa('const m = await import("@/pwa/register");')).toEqual(["@/pwa/register"]);
    expect(importsPwa('import { AppShell } from "../(owner)/app-shell";')).toEqual([
      "../(owner)/app-shell",
    ]);
    expect(importsPwa('import { cn } from "@/lib/cn";')).toEqual([]);
  });
});
