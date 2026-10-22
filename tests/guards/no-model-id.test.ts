import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// M3 acceptance test 5 (ADR-004): the extraction model ID comes from EXTRACTION_MODEL_ID and is
// never a literal in src/. A model ID looks like "claude-<something>" or "anthropic.claude...".
const MODEL_ID_PATTERNS = [/\bclaude-[a-z0-9]/i, /anthropic\.claude/i];

function findModelIds(source: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  source.split("\n").forEach((text, index) => {
    if (MODEL_ID_PATTERNS.some((pattern) => pattern.test(text))) {
      hits.push({ line: index + 1, text: text.trim() });
    }
  });
  return hits;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("no model ID literal in src/", () => {
  it("the scanner finds model IDs (self-test)", () => {
    expect(findModelIds('const m = "claude-test-1";')).toEqual([
      { line: 1, text: 'const m = "claude-test-1";' },
    ]);
    expect(findModelIds("ok\nid: anthropic.claude-x")).toHaveLength(1);
    expect(findModelIds("const m = process.env.X; // Claude API")).toEqual([]);
  });

  it("finds none in src/**/*.{ts,tsx}", () => {
    const root = join(process.cwd(), "src");
    const offences = sourceFiles(root).flatMap((file) =>
      findModelIds(readFileSync(file, "utf8")).map(
        (hit) => `${relative(process.cwd(), file)}:${hit.line}: ${hit.text}`,
      ),
    );
    expect(offences).toEqual([]);
  });
});
