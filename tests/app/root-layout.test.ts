import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The root layout reads x-nonce, which makes every page render per request. Without the header (a path the proxy skips)
// it renders with no nonce, so the static policy blocks Next's inline scripts; a malformed one still throws (ADR-028).
const N = "AAAAAAAAAAAAAAAAAAAAAA==";
let incoming: Headers;
vi.mock("next/headers", () => ({ headers: async () => incoming }));
vi.mock("next/font/local", () => ({
  default: (options: { variable: string }) => ({
    variable: options.variable === "--font-display-face" ? "font-display-test" : "font-body-test",
  }),
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

  it("renders without throwing when the proxy did not run (a path it skips, e.g. a missing /foo.png)", async () => {
    const tree = await RootLayout({ children: createElement("main", null, "non trovato") });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('<html lang="it"');
    expect(html).toContain("non trovato");
  });

  it("holds no header band: the (public) and (owner) layouts and the 404 page each bring their own (QW1)", async () => {
    const tree = await RootLayout({ children: createElement("main", null, "contenuto") });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain("<header");
    expect(html).not.toContain('href="/"');
  });

  it("rejects a present but malformed x-nonce", async () => {
    incoming = new Headers({ "x-nonce": "abc" });
    await expect(RootLayout({ children: null })).rejects.toThrow("csp_nonce_missing");
  });

  it("rejects an empty x-nonce", async () => {
    incoming = new Headers({ "x-nonce": "" });
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
