import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// UX plan B5: one BackLink (src/components/back-link.tsx), drawn at the top of the page. A private copy in a page
// file, or a "← label" link written by hand, would bring the old end-of-page back links back.
const SRC = join(__dirname, "../../src/app");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });

// The comanda's own top link and the sticky-bar screens keep their text arrow (their e2e specs name it).
const EXEMPT = ["tavoli/comanda/page.tsx"];

describe("back links", () => {
  const pages = files(SRC).filter((file) => !EXEMPT.some((exempt) => file.endsWith(exempt)));

  it("no page file defines its own BackLink", () => {
    const own = pages.filter((file) => /function BackLink\b/.test(readFileSync(file, "utf8")));
    expect(own).toEqual([]);
  });

  it("no page writes a '← label' back link by hand", () => {
    const handmade = pages.filter((file) => /^\s*← (\{|[A-Z])/m.test(readFileSync(file, "utf8")));
    expect(handmade).toEqual([]);
  });
});
