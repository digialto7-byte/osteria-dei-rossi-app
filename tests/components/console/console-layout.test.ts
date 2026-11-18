import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// SP3 step 18, step 15: the console layouts. A product surface (Costì look, Forest chrome), no venue layer, no service worker.
import ConsoleLayout, { metadata, viewport } from "@/app/(platform)/console/layout";
import LoginLayout from "@/app/(platform)/console/login/layout";
import { PRODUCT_THEMES } from "@/lib/design/tokens";

const ROOT = new URL("../../../", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const CONSOLE_DIRS = ["src/app/(platform)", "src/components/console", "src/lib/console"];

describe("the console layout", () => {
  it("the tab title is «Costì · Console»", () => {
    expect(metadata.title).toBe("Costì · Console");
  });

  it("the browser chrome continues the product's Forest band", () => {
    expect(viewport.themeColor).toBe(PRODUCT_THEMES.light.band);
  });

  it("renders its children, nothing else", () => {
    const html = renderToStaticMarkup(
      createElement(ConsoleLayout, null, createElement("p", null, "figlio")),
    );
    expect(html).toBe("<p>figlio</p>");
  });
});

describe("the sign-in frame", () => {
  const html = renderToStaticMarkup(
    createElement(LoginLayout, null, createElement("h1", null, "Pagina")),
  );

  it("has the console band «Costì · Console», the product logo and exactly one main", () => {
    expect(html).toContain("Costì · Console");
    expect(html).toContain('alt="Costì"');
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/<header/g)).toHaveLength(1);
  });

  it("puts the logo and the page inside the main, after the band", () => {
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    const main = html.slice(html.indexOf("<main"));
    expect(main).toContain("<picture>");
    expect(main).toContain("<h1>Pagina</h1>");
  });

  it("has no «Esci» in the band: nobody is signed in on these pages", () => {
    expect(html.slice(0, html.indexOf("</header>"))).not.toContain("<button");
  });
});

function sourcesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const consoleFiles = CONSOLE_DIRS.flatMap((dir) => sourcesUnder(join(ROOT, dir)));
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

function specifiers(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((m) => m[1]!);
}

/** The file a local specifier points at ("@/x" is src/x), or null for a package. */
function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (base === null) return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    base,
  ])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

/** Every module reachable from the entries through local imports (the entries included). */
function reachable(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const specs = specifiers(readFileSync(file, "utf8"));
    seen.set(file, specs);
    for (const spec of specs) {
      const next = resolveLocal(file, spec);
      if (next !== null) queue.push(next);
    }
  }
  return seen;
}

const rel = (file: string) => file.slice(ROOT.length);

describe("what the console tree may load", () => {
  it("the scan sees the console files", () => {
    expect(consoleFiles.length).toBeGreaterThan(10);
    expect(consoleFiles.map(rel)).toContain("src/components/console/console-band.tsx");
  });

  it("the import walk follows local modules and sees the venue layer through HeaderBand", () => {
    const graph = reachable(consoleFiles);
    expect(graph.size).toBeGreaterThan(consoleFiles.length);
    expect([...graph.keys()].map(rel)).toContain("src/components/header-band.tsx");
  });

  it("no console file imports the venue layer directly (HeaderBand does, for a prop the band never passes)", () => {
    const offenders = consoleFiles.filter((file) =>
      specifiers(readFileSync(file, "utf8")).some((s) => s.startsWith("@/lib/design/venue-layer")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no module reachable from the console files imports @/pwa/", () => {
    const offenders = [...reachable(consoleFiles)]
      .filter(([, specs]) => specs.some((s) => s === "@/pwa" || s.startsWith("@/pwa/")))
      .map(([file]) => rel(file));
    expect(offenders).toEqual([]);
  });

  it("no console file contains the word the console guard forbids", () => {
    const word = new RegExp(["real", "time"].join(""), "i");
    expect(consoleFiles.filter((f) => word.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });

  it("no console file imports a Supabase package or wrapper", () => {
    const offenders = consoleFiles.filter((file) =>
      specifiers(readFileSync(file, "utf8")).some(
        (s) => s.startsWith("@supabase/") || s.startsWith("@/lib/supabase"),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
