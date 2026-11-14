import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Costì plan CB2: the venue's name is data (`venue.name`), never a literal in code. The only string literals in src/ that may contain it
// are the catalogue entries `venue.name` and `brand.homeLink` (the home link's accessible name). Comments are not string literals.
const NAME = "Osteria Dei Rossi";
const ALLOWED_KEYS = new Set(["venue.name", "brand.homeLink"]);
const SRC = new URL("../../src/", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

/** Literal tokens (strings, template parts, JSX text) that contain the name, with the property key they belong to if any. */
function venueLiterals(source: string, fileName = "x.tsx"): { text: string; key?: string }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: { text: string; key?: string }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      if (node.text.includes(NAME)) {
        const parent = node.parent;
        const key =
          parent && ts.isPropertyAssignment(parent) && parent.initializer === node
            ? ts.isStringLiteral(parent.name) || ts.isIdentifier(parent.name)
              ? parent.name.text
              : undefined
            : undefined;
        found.push({ text: node.text, key });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("no venue-name literal in src/", () => {
  it("finds the name only in the venue.name and brand.homeLink catalogue entries", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      for (const hit of venueLiterals(readFileSync(file, "utf8"), file)) {
        if (!hit.key || !ALLOWED_KEYS.has(hit.key))
          offenders.push(`${file.slice(SRC.length)}: ${hit.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scanner sees a literal, a JSX text and a template, and ignores a comment", () => {
    expect(venueLiterals(`const a = "${NAME}";`)).toHaveLength(1);
    expect(venueLiterals(`const a = <p>${NAME}</p>;`)).toHaveLength(1);
    expect(venueLiterals(`const a = \`x ${NAME} y\`;`)).toHaveLength(1);
    expect(venueLiterals(`// ${NAME}\n/* ${NAME} */ const a = 1;`)).toHaveLength(0);
  });

  it("the scanner reports the property key of a catalogue entry", () => {
    expect(venueLiterals(`const m = { "venue.name": "${NAME}" };`)).toEqual([
      { text: NAME, key: "venue.name" },
    ]);
    expect(venueLiterals(`const m = { "app.name": "${NAME}" };`)[0]?.key).toBe("app.name");
  });
});
