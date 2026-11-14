import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("K-b: no reveal animation on /cucina", () => {
  it("has an unlayered [data-kitchen] rule after the reduced-motion block", () => {
    const reducedAt = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(reducedAt).toBeGreaterThan(-1);
    const rule = /\[data-kitchen\],\s*\[data-kitchen\] \*\s*\{\s*animation:\s*none;/.exec(
      css.slice(reducedAt),
    );
    expect(rule).not.toBeNull();
    const at = reducedAt + (rule?.index ?? 0);
    // Unlayered: brace depth is 0 at the rule, counted from the start of the file.
    let depth = 0;
    for (const ch of css.slice(0, at)) {
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
    }
    expect(depth).toBe(0);
  });
});
