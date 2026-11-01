import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ADR-028: script-src keeps 'unsafe-inline', so injection is closed by construction: no raw-HTML sink in src/.
const SINKS =
  /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|from "next\/script"/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("no raw-HTML sink in src/", () => {
  const files = sourceFiles(new URL("../../src", import.meta.url).pathname);

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no file uses a raw-HTML sink or next/script", () => {
    const hits = files.filter((f) => SINKS.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the pattern catches each sink (self-test)", () => {
    for (const s of [
      "<div dangerouslySetInnerHTML={x} />",
      "el.innerHTML = x",
      "el.outerHTML = x",
      "el.insertAdjacentHTML('a', x)",
      "document.write(x)",
      'import Script from "next/script"',
    ]) {
      expect(SINKS.test(s), s).toBe(true);
    }
  });
});
