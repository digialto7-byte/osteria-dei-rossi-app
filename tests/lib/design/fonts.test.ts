import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// GDPR (EU venue): fonts are self-hosted by next/font at build time; the browser must never
// call Google. This is the source-level guard; e2e/fonts.spec.ts checks the built app.
const GOOGLE_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/;

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

  it("the root layout loads its faces through next/font (downloaded at build, served from /_next)", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/from "next\/font\/google"/);
    expect(layout).toMatch(/Bodoni_Moda\(/);
    expect(layout).toMatch(/Figtree\(/);
    expect(layout).not.toMatch(/<link[^>]+stylesheet/);
  });

  it("loads only the faces in use: no retired family, no italic, one display weight", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/Instrument_Serif|Atkinson_Hyperlegible|Source_Serif_4/);
    expect(layout).not.toMatch(/"italic"/);
    expect(layout).toMatch(/Bodoni_Moda\(\{\s*weight: "600",/);
  });
});
