import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Reservations plan §3.8 and §5 B11, ADR-028: the public booking page is built to the nonce policy. Under src/app/(public)/prenota/** there is no inline script,
// no `next/script`, no `dangerouslySetInnerHTML`, no `style=` and no http(s):// literal (a third-party origin or a mixed-content link).
const ROOT = join(__dirname, "../..");
const DIR = join(ROOT, "src/app/(public)/prenota");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });

/** Drops block comments and whole-line `//` comments: prose may name what the page must not do. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RULES: [string, RegExp][] = [
  ["an inline script tag", /<script\b/i],
  ["next/script", /next\/script/],
  ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
  ["an inline style attribute", /\bstyle\s*=/],
  ["an http(s) literal", /https?:\/\//i],
  ["an inline event handler attribute string", /\bon[a-z]+\s*=\s*["']/i],
  ["javascript: URL", /javascript:/i],
];

/** The rules a source breaks. */
export function violations(source: string): string[] {
  const text = code(source);
  return RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

describe("the public booking page keeps to the nonce CSP", () => {
  it("the rules catch what they name (self-test)", () => {
    expect(violations("<script>alert(1)</script>")).toContain("an inline script tag");
    expect(violations('import Script from "next/script";')).toContain("next/script");
    expect(violations("<div dangerouslySetInnerHTML={{ __html: x }} />")).toContain(
      "dangerouslySetInnerHTML",
    );
    expect(violations('<div style="color:red" />')).toContain("an inline style attribute");
    expect(violations("<div style={{ top: 1 }} />")).toContain("an inline style attribute");
    expect(violations('const u = "http://x.test";')).toContain("an http(s) literal");
    expect(violations('const u = "https://x.test";')).toContain("an http(s) literal");
    expect(violations('<a href="javascript:void(0)" />')).toContain("javascript: URL");
    expect(violations('<a onclick="x()" />')).toContain("an inline event handler attribute string");
    // Prose in a comment, a React handler and class names are fine.
    expect(violations("// no <script> here, nor https://x.test\n/* style= */")).toEqual([]);
    expect(violations('<button onClick={go} className="mt-2">ok</button>')).toEqual([]);
  });

  it("scans the page files", () => {
    const found = files(DIR).map((f) => relative(DIR, f));
    for (const name of [
      "[slug]/page.tsx",
      "[slug]/request-form.tsx",
      "[slug]/slot-picker.tsx",
      "[slug]/privacy-notice.tsx",
      "[slug]/annulla/page.tsx",
      "[slug]/annulla/cancel-view.tsx",
    ]) {
      expect(found, name).toContain(name);
    }
  });

  it("finds no violation in src/app/(public)/prenota/**", () => {
    const broken = files(DIR).flatMap((file) =>
      violations(readFileSync(file, "utf8")).map((rule) => `${relative(ROOT, file)}: ${rule}`),
    );
    expect(broken).toEqual([]);
  });
});
