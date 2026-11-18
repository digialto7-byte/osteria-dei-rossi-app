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

/** Line numbers of string literals, no-substitution templates and template parts that hold the zone name. */
function zoneLiterals(source: string, fileName = "x.tsx"): number[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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

/** True when the source imports VENUE_TIME_ZONE. */
function importsVenueTimeZone(source: string): boolean {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
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
    expect(zoneLiterals(text)).toEqual([1, 2, 3, 4]);
  });

  it("finds an import of VENUE_TIME_ZONE, also renamed, and nothing else", () => {
    expect(importsVenueTimeZone('import { VENUE_TIME_ZONE } from "@/lib/time/format";')).toBe(true);
    expect(importsVenueTimeZone('import { x, VENUE_TIME_ZONE as z } from "y";')).toBe(true);
    expect(importsVenueTimeZone('import { formatTime } from "@/lib/time/format";')).toBe(false);
  });
});

describe("src/", () => {
  const root = process.cwd();
  const sources = files(join(root, "src")).map((f) => ({
    path: relative(root, f),
    text: readFileSync(f, "utf8"),
  }));

  it("has no \"Europe/Rome\" or 'Europe/Rome' string-literal token outside src/lib/venue/settings.ts", () => {
    const found = sources
      .filter((s) => s.path !== HOME)
      .flatMap((s) => zoneLiterals(s.text, s.path).map((line) => `${s.path}:${line}`));
    expect(found).toEqual([]);
  });

  it("holds the one literal at its home", () => {
    const home = sources.find((s) => s.path === HOME)!;
    expect(zoneLiterals(home.text, HOME)).toHaveLength(1);
  });

  it("imports VENUE_TIME_ZONE only under src/lib/console/ and src/lib/time/", () => {
    const importers = sources
      .filter((s) => importsVenueTimeZone(s.text))
      .map((s) => s.path)
      .filter((p) => !ALIAS_HOMES.some((home) => p.startsWith(home)));
    expect(importers).toEqual([]);
  });
});
