import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The root layout reads x-nonce, which makes every page render per request and fails closed when the proxy did not
// run (ADR-028).
const N = "AAAAAAAAAAAAAAAAAAAAAA==";
let incoming: Headers;
vi.mock("next/headers", () => ({ headers: async () => incoming }));
vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "font-display-test" }),
  Figtree: () => ({ variable: "font-body-test" }),
}));

const { default: RootLayout } = await import("@/app/layout");

beforeEach(() => {
  incoming = new Headers();
});

describe("RootLayout", () => {
  it("renders <html lang=it> with the font classes, and the nonce is nowhere in the markup", async () => {
    incoming = new Headers({ "x-nonce": N });
    const tree = await RootLayout({ children: createElement("main", null, "contenuto") });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('<html lang="it"');
    expect(html).toContain("font-display-test");
    expect(html).toContain("font-body-test");
    expect(html).toContain("contenuto");
    expect(html).not.toContain(N);
  });

  it("rejects with csp_nonce_missing when the proxy did not run", async () => {
    await expect(RootLayout({ children: null })).rejects.toThrow("csp_nonce_missing");
  });

  it("rejects a malformed x-nonce", async () => {
    incoming = new Headers({ "x-nonce": "abc" });
    await expect(RootLayout({ children: null })).rejects.toThrow("csp_nonce_missing");
  });
});

describe("no static rendering escape hatch under src/app", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it("no file exports dynamic, revalidate or dynamicParams, or says force-static", () => {
    const offenders = files(join(process.cwd(), "src/app")).filter((file) =>
      /export const (dynamic|revalidate|dynamicParams)\b|force-static/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
