import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// SP1 step 12 (plan §3.6, H9). The venue's zone is data (`tenant.timezone`, read through /api/me and tenant_settings()). The only
// `Europe/Rome` string literal in src/ is DEFAULT_TIME_ZONE in src/lib/venue/settings.ts, and only the platform console and the time
// module may import VENUE_TIME_ZONE (the alias of that constant). Comments are not string literals.
const ZONE = "Europe/Rome";
const HOME = "src/lib/venue/settings.ts";
const ALIAS_HOMES = ["src/lib/console/", "src/lib/time/"];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

/**
 * One syntax tree per file, built once while the suite is collected: the checks below only walk it. Building the trees inside the
 * test bodies (twice per file) took the literal check past vitest's 5 s default on a loaded runner (#183, CI run 44336401274).
 */
function parse(source: string, fileName = "x.tsx"): ts.SourceFile {
  // The kind follows the extension: a .ts file read as TSX would misparse a `<T>value` assertion.
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
}

/** Line numbers of string literals, no-substitution templates and template parts that hold the zone name. */
function zoneLiterals(sf: ts.SourceFile): number[] {
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes(ZONE)
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

/** True when the file imports VENUE_TIME_ZONE. */
function importsVenueTimeZone(sf: ts.SourceFile): boolean {
  return sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some(
        (el) => (el.propertyName ?? el.name).text === "VENUE_TIME_ZONE",
      ),
  );
}

describe("the scanner", () => {
  it("finds double-quoted, single-quoted and template literals, not comments", () => {
    const text = [
      'const a = "Europe/Rome";',
      "const b = 'Europe/Rome';",
      "const c = `Europe/Rome`;",
      "const d = `Europe/Rome ${x}`;",
      "// Europe/Rome in a comment",
      "/** Europe/Rome in a doc comment */",
      "const e = 1;",
    ].join("\n");
    expect(zoneLiterals(parse(text))).toEqual([1, 2, 3, 4]);
  });

  it("finds an escaped literal: the cooked value is checked, not the source text", () => {
    expect(
      zoneLiterals(parse('const a = "Europe\\u002FRome";\nconst b = "Europe\\/Rome";')),
    ).toEqual([1, 2]);
  });

  it("reads a .ts file as TS: a `<T>value` assertion does not hide a literal below it (read as TSX, it opens JSX)", () => {
    const text = 'const n = <number>x;\nconst z = "Europe/Rome";';
    expect(zoneLiterals(parse(text, "a.ts"))).toEqual([2]);
  });

  it("finds an import of VENUE_TIME_ZONE, also renamed, and nothing else", () => {
    expect(
      importsVenueTimeZone(parse('import { VENUE_TIME_ZONE } from "@/lib/time/format";')),
    ).toBe(true);
    expect(importsVenueTimeZone(parse('import { x, VENUE_TIME_ZONE as z } from "y";'))).toBe(true);
    expect(importsVenueTimeZone(parse('import { formatTime } from "@/lib/time/format";'))).toBe(
      false,
    );
  });
});

describe("src/", () => {
  const root = process.cwd();
  const sources = files(join(root, "src")).map((f) => {
    const path = relative(root, f);
    return { path, sf: parse(readFileSync(f, "utf8"), path) };
  });

  it("has no \"Europe/Rome\" or 'Europe/Rome' string-literal token outside src/lib/venue/settings.ts", () => {
    const found = sources
      .filter((s) => s.path !== HOME)
      .flatMap((s) => zoneLiterals(s.sf).map((line) => `${s.path}:${line}`));
    expect(found).toEqual([]);
  });

  it("holds the one literal at its home", () => {
    const home = sources.find((s) => s.path === HOME)!;
    expect(zoneLiterals(home.sf)).toHaveLength(1);
  });

  it("imports VENUE_TIME_ZONE only under src/lib/console/ and src/lib/time/", () => {
    const importers = sources
      .filter((s) => importsVenueTimeZone(s.sf))
      .map((s) => s.path)
      .filter((p) => !ALIAS_HOMES.some((home) => p.startsWith(home)));
    expect(importers).toEqual([]);
  });
});
