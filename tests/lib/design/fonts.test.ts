import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// GDPR (EU venue): fonts are self-hosted (committed woff2, next/font/local); the browser must never
// call Google. This is the source-level guard; e2e/fonts.spec.ts checks the built app.
const GOOGLE_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/;
const FONT_FILES = [
  // The Costì faces (docs/plans/2026-11-13-costi-product-brand.md §3.4): full upstream files, not subset.
  "montserrat-600-normal.woff2",
  "inter-400-normal.woff2",
  "inter-700-normal.woff2",
];
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("fonts are self-hosted", () => {
  it("no source file or public asset references the Google Fonts hosts", () => {
    const root = process.cwd();
    const files = ["src", "public"]
      .map((dir) => join(root, dir))
      .filter((dir) => existsSync(dir))
      .flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((file) => GOOGLE_FONT_HOSTS.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });

  // fix/self-host-fonts (2026-11-08): next/font/google fetched the files from Google at build time, and a failed fetch broke
  // `npm run build` in CI (run 42513051864). The faces are now committed woff2 files with their OFL licences, loaded by
  // next/font/local: the build needs no network and the browser still gets them from /_next/static/media.
  it("the root layout loads its faces through next/font/local, from committed files (no build-time download)", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/from "next\/font\/local"/);
    expect(layout).not.toMatch(/<link[^>]+stylesheet/);
    for (const file of FONT_FILES) {
      expect(layout, file).toContain(`./fonts/${file}`);
      expect(existsSync(join(process.cwd(), "src/app/fonts", file)), file).toBe(true);
    }
  });

  it("no source file imports next/font/google", () => {
    const offenders = sourceFiles(join(process.cwd(), "src"))
      .filter((file) => /\.(tsx?|jsx?|mjs|cjs|css)$/.test(file))
      .filter((file) => /next\/font\/google/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it("each committed face ships with its SIL Open Font License, and nothing else is committed", () => {
    for (const licence of ["OFL-Montserrat.txt", "OFL-Inter.txt"]) {
      const text = readFileSync(join(process.cwd(), "src/app/fonts", licence), "utf8");
      expect(text, licence).toContain("SIL Open Font License, Version 1.1");
    }
    const all = readdirSync(join(process.cwd(), "src/app/fonts"));
    expect(all.filter((f) => f.endsWith(".woff2")).sort()).toEqual([...FONT_FILES].sort());
    expect(all.filter((f) => f.endsWith(".txt")).sort()).toEqual([
      "OFL-Inter.txt",
      "OFL-Montserrat.txt",
    ]);
  });

  // P2j: Costì is the :root theme, so Montserrat (headings) and Inter (body) are the two root faces, preloaded, on the two variables the
  // font stacks end in. There is no latin-ext split (the files are full-charset) and no remap in globals.css.
  it("loads Montserrat and Inter as the two root faces: --font-display-face and --font-body, swap, Arial fallback metrics, preloaded", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('variable: "--font-display-face"');
    expect(layout).toContain('variable: "--font-body"');
    expect(layout).toMatch(/const montserrat = localFont\(/);
    expect(layout).toMatch(/const inter = localFont\(/);
    expect(layout).toContain("${montserrat.variable}");
    expect(layout).toContain("${inter.variable}");
    expect(layout.match(/localFont\(/g)).toHaveLength(2);
    expect(layout.match(/display: "swap"/g)).toHaveLength(2);
    expect(layout.match(/preload: false/g)).toBeNull();
    expect(layout.match(/adjustFontFallback: "Arial"/g)).toHaveLength(2);
    expect(layout).not.toContain("Times New Roman");
    expect(layout).not.toContain("unicode-range");
    expect(layout).not.toMatch(/--font-[a-z]+-ext|--font-product/);
  });

  it("the stacks start with the two variables and nothing in globals.css remaps a --font-* variable", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/--font-sans:\s+var\(--font-body\),/);
    expect(css).toMatch(/--font-display:\s+var\(--font-display-face\),/);
    expect(css).not.toMatch(/--font-(display-face|display-ext|body|body-ext|product-[a-z]+):/);
    expect(css).not.toMatch(/unicode-range/);
  });

  it("loads only the faces in use: no retired family, no italic, Montserrat 600 and Inter 400 and 700", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).not.toMatch(
      /Instrument_Serif|Atkinson_Hyperlegible|Source_Serif_4|Bodoni|Figtree/i,
    );
    expect(layout).not.toMatch(/"italic"/);
    const entries = [
      ...layout.matchAll(/path: "\.\/fonts\/([a-z-]+)-(\d00)-normal\.woff2", weight: "(\d00)"/g),
    ];
    expect(entries.length).toBe(FONT_FILES.length);
    const weightsOf = (family: string) =>
      entries.filter(([, file]) => file!.startsWith(family)).map(([, , , weight]) => weight);
    for (const [, file, fileWeight, weight] of entries) expect(weight, file).toBe(fileWeight);
    expect(weightsOf("montserrat")).toEqual(["600"]);
    expect(weightsOf("inter").sort()).toEqual(["400", "700"]);
    expect(layout).not.toMatch(/montserrat-700|montserrat-400|inter-500|inter-600/);
  });

  it("no licence of a shipped face declares a Reserved Font Name (checked on the files shipped, 2026-11-13)", () => {
    for (const licence of ["OFL-Montserrat.txt", "OFL-Inter.txt"]) {
      const text = readFileSync(join(process.cwd(), "src/app/fonts", licence), "utf8");
      expect(text, licence).not.toMatch(/with Reserved Font Name/i);
      expect(text, licence).toMatch(/^Copyright .* Project Authors/);
    }
  });
});
