import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// P2j retired the osteria theme (docs/ux/costi-design-system.md §11 step 9, #181). ui-foundation.md keeps the old theme only as history in
// §12; anywhere else in that file a "Bodoni" or "Figtree" would describe a face the app no longer loads. Whole words, as written: a file name
// such as display-font-bodoni.png, which only points at a history screenshot, is not a font named as current.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const RETIRED_FACE = /\b(?:Bodoni|Figtree)\b/;
const HISTORY = /^## 12\. History\b.*$/m;

/** The file without its §12 History section (from its heading to the next "## " heading, or the end). */
function outsideHistory(doc: string): string {
  const start = doc.search(HISTORY);
  if (start === -1) throw new Error("ui-foundation.md has no '## 12. History' section");
  const rest = doc.slice(start + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? doc.slice(0, start) : doc.slice(0, start) + rest.slice(next);
}

describe("docs/design/ui-foundation.md names the retired faces only in §12 History", () => {
  const doc = read("docs/design/ui-foundation.md");

  it("§12 History exists and still records the retired faces", () => {
    expect(doc).toMatch(HISTORY);
    expect(doc.slice(doc.search(HISTORY))).toMatch(RETIRED_FACE);
  });

  it("no 'Bodoni' or 'Figtree' outside §12", () => {
    const lines = outsideHistory(doc)
      .split("\n")
      .filter((line) => RETIRED_FACE.test(line));
    expect(lines).toEqual([]);
  });

  it("the check catches a retired face before §12 and after it, and lets a history file name through", () => {
    const sample =
      "## 11. Theme\nBody is Figtree.\n## 12. History\nBodoni Moda.\n## 13. Later\nA Bodoni title.\n";
    expect(outsideHistory(sample)).toContain("Figtree");
    expect(outsideHistory(sample)).toContain("A Bodoni title");
    expect(outsideHistory(sample)).not.toContain("Bodoni Moda.");
    expect("see display-font-bodoni.png").not.toMatch(RETIRED_FACE);
  });
});
