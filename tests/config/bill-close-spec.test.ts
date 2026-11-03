import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 9 (G12): e2e/bill-close.spec.ts needs the Supabase stack, so this reads its source. The bill's "Chiudi tavolo" button and
// the close sheet's submit button carry the same name; every click on either is located inside `main` or `[data-close-sheet]`, with
// an exact name, and no position (.first, .last, .nth) picks between them.
const source = readFileSync(new URL("../../e2e/bill-close.spec.ts", import.meta.url), "utf8");
const lines = source.split("\n").filter((line) => !/^\s*\/\//.test(line));
const code = lines.join("\n");

describe("e2e/bill-close.spec.ts", () => {
  it("has no unscoped button named Chiudi tavolo on the waiter's page", () => {
    expect(code).not.toMatch(
      /waiter\.page\s*\.getByRole\("button",\s*\{\s*name:\s*"Chiudi tavolo"/,
    );
    expect(code).not.toMatch(/\bpage\s*\.getByRole\("button",\s*\{\s*name:\s*"Chiudi tavolo"/);
  });

  it("locates every Chiudi tavolo button inside main or the close sheet, with an exact name", () => {
    const uses = [...code.matchAll(/getByRole\("button",\s*\{[^}]*"Chiudi tavolo"[^}]*\}\)/g)];
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const use of uses) {
      expect(use[0], use[0]).toMatch(/exact:\s*true/);
      const before = code.slice(Math.max(0, use.index! - 120), use.index);
      expect(before, use[0]).toMatch(/main\(waiter\.page\)\s*\.$|\[data-close-sheet\]"\)\s*\.$/);
    }
  });

  it("picks nothing by position", () => {
    expect(code).not.toMatch(/\.(first|last|nth)\(/);
  });
});
