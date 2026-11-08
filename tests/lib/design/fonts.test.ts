import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// GDPR (EU venue): fonts are self-hosted (committed woff2, next/font/local); the browser must never
// call Google. This is the source-level guard; e2e/fonts.spec.ts checks the built app.
const GOOGLE_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/;
const FONT_FILES = [
  "bodoni-moda-latin-600-normal.woff2",
  "bodoni-moda-latin-ext-600-normal.woff2",
  "figtree-latin-400-normal.woff2",
  "figtree-latin-700-normal.woff2",
  "figtree-latin-ext-400-normal.woff2",
  "figtree-latin-ext-700-normal.woff2",
];
// Google's latin-ext unicode-range, as Fontsource 5.3.0 declares it.
const LATIN_EXT_RANGE =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

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

  it("each committed face ships with its SIL Open Font License", () => {
    for (const licence of ["OFL-BodoniModa.txt", "OFL-Figtree.txt"]) {
      const text = readFileSync(join(process.cwd(), "src/app/fonts", licence), "utf8");
      expect(text, licence).toContain("SIL Open Font License, Version 1.1");
    }
    const committed = readdirSync(join(process.cwd(), "src/app/fonts")).filter((f) =>
      f.endsWith(".woff2"),
    );
    expect(committed.sort()).toEqual([...FONT_FILES].sort());
  });

  it("keeps the same CSS variables, swap, and metric-adjusted fallbacks", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('variable: "--font-display-face"');
    expect(layout).toContain('variable: "--font-body"');
    expect(layout.match(/display: "swap"/g)).toHaveLength(4);
    expect(layout).toContain('adjustFontFallback: "Times New Roman"');
    expect(layout).toContain('adjustFontFallback: "Arial"');
  });

  // Code review of fix/self-host-fonts: next/font/google also served latin-ext (not preloaded), so names such as
  // "Ștefan" or "Żubrówka" stayed in the brand face. The latin-ext files are a second face per family, limited to
  // Google's latin-ext range, not preloaded (downloaded only when a page has such a letter), and listed BEFORE the main
  // face in the CSS stack: its range keeps it out of plain latin text, and the main stack ends in a fallback face that
  // covers every letter, so anything after it would never be reached.
  it("latin-ext is a second, non-preloaded face per family, limited to Google's range and first in the stack", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('variable: "--font-display-ext"');
    expect(layout).toContain('variable: "--font-body-ext"');
    expect(layout.match(/preload: false/g)).toHaveLength(2);
    expect(layout.match(/adjustFontFallback: false/g)).toHaveLength(2);
    // next/font accepts only literals in its options, so the range is written out in both latin-ext calls.
    expect(layout.split(`value: "${LATIN_EXT_RANGE}"`).length - 1).toBe(2);
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/--font-sans:\s+var\(--font-body-ext\), var\(--font-body\),/);
    expect(css).toMatch(/--font-display:\s+var\(--font-display-ext\), var\(--font-display-face\),/);
  });

  it("loads only the faces in use: no retired family, no italic, one display weight", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/Instrument_Serif|Atkinson_Hyperlegible|Source_Serif_4/);
    expect(layout).not.toMatch(/"italic"/);
    // Bodoni at 600 only, Figtree at 400 and 700 only (latin and latin-ext alike), tied to the file names.
    const entries = [
      ...layout.matchAll(/path: "\.\/fonts\/([a-z-]+)-(\d00)-normal\.woff2", weight: "(\d00)"/g),
    ];
    expect(entries.length).toBe(FONT_FILES.length);
    for (const [, file, fileWeight, weight] of entries) {
      expect(weight, file).toBe(fileWeight);
      expect(weight, file).toBe(
        file!.startsWith("bodoni-moda") ? "600" : weight === "400" ? "400" : "700",
      );
    }
  });
});
