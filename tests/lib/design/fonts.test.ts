import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// GDPR (EU venue): fonts are self-hosted (committed woff2, next/font/local); the browser must never
// call Google. This is the source-level guard; e2e/fonts.spec.ts checks the built app.
const GOOGLE_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/;
const FONT_FILES = [
  "bodoni-moda-latin-600-normal.woff2",
  "figtree-latin-400-normal.woff2",
  "figtree-latin-700-normal.woff2",
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
    expect(layout.match(/display: "swap"/g)).toHaveLength(2);
    expect(layout).toContain('adjustFontFallback: "Times New Roman"');
    expect(layout).toContain('adjustFontFallback: "Arial"');
  });

  it("loads only the faces in use: no retired family, no italic, one display weight", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/Instrument_Serif|Atkinson_Hyperlegible|Source_Serif_4/);
    expect(layout).not.toMatch(/"italic"/);
    expect(layout.match(/weight: "\d00"/g)?.sort()).toEqual([
      'weight: "400"',
      'weight: "600"',
      'weight: "700"',
    ]);
  });
});
