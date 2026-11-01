import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M24 step 9 (plan §3.1.9, AT3, ADR-027): one global print block sets A4, hides every navigation and status slot, and the dark palette is limited
// to the screen so paper always gets the light colours. The real PDF is checked in e2e/exports.spec.ts (T1).
const css = readFileSync("src/app/globals.css", "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The text between the braces of the block that starts at `open` (the index of its "{"). */
function bodyFrom(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced braces");
}

function blocksOf(text: string, header: RegExp): string[] {
  return [...text.matchAll(new RegExp(header.source, "g"))].map((m) =>
    bodyFrom(text, m.index + m[0].length - 1),
  );
}

const PRINT_HIDDEN = [
  "nav",
  '[data-slot="sync-status"]',
  '[data-slot="nav-placeholder"]',
  '[data-slot="sidebar-placeholder"]',
  '[data-print="hide"]',
];

describe("the print block", () => {
  const blocks = blocksOf(code, /@media\s+print\s*\{/);

  it("exists exactly once", () => {
    expect(blocks).toHaveLength(1);
  });

  it("sets the page to A4 with a 12 mm margin", () => {
    const page = blocksOf(blocks[0]!, /@page\s*\{/);
    expect(page).toHaveLength(1);
    expect(page[0]).toMatch(/size:\s*A4\s*;/);
    expect(page[0]).toMatch(/margin:\s*12mm\s*;/);
  });

  it("hides the navigation, the status slots and the screen-only controls with display: none !important", () => {
    const rest = blocks[0]!.replace(/@page\s*\{[^}]*\}/, "");
    const rule = /([^{}]+)\{([^}]*)\}/g;
    const hidden = new Set<string>();
    for (const [, selectors = "", body = ""] of rest.matchAll(rule)) {
      if (/display:\s*none\s*!important/.test(body)) {
        for (const s of selectors.split(",")) hidden.add(s.trim());
      }
    }
    for (const selector of PRINT_HIDDEN) expect(hidden, selector).toContain(selector);
  });

  it("prints with the light colour scheme", () => {
    expect(blocks[0]).toMatch(/color-scheme:\s*light\s*;/);
  });

  it("defines no colour of its own (the tokens are not duplicated)", () => {
    expect(blocks[0]).not.toMatch(/--color-/);
    expect(blocks[0]).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("the dark palette is for the screen only", () => {
  it("is limited by `screen and (prefers-color-scheme: dark)`", () => {
    expect(code).toMatch(/@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{/);
  });

  it("no other prefers-color-scheme: dark query exists", () => {
    const all = code.match(/prefers-color-scheme:\s*dark/g) ?? [];
    expect(all).toHaveLength(1);
    expect(code).not.toMatch(/@media\s+\(prefers-color-scheme:\s*dark\)/);
  });
});
