import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  const SRC_APP = join(process.cwd(), "src/app");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  // The one exemption (SP3 step 16): the manifest is a route handler, not a page, and it is prerendered as before (e2e T2). It may say
  // exactly `export const dynamic = "force-static"`; anything else in that file still counts.
  const EXEMPT = "manifest.webmanifest/route.ts";
  const ALLOWED = /export const dynamic = "force-static";?/;
  const HATCH = /export const (dynamic|revalidate|dynamicParams)\b|force-static/;

  /** Files under `dir` with an escape hatch, the exempt file's one allowed statement removed. */
  function offenders(dir: string, exempt: string): string[] {
    return files(dir)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return HATCH.test(file === join(dir, exempt) ? source.replace(ALLOWED, "") : source);
      })
      .map((file) => file.slice(dir.length + 1));
  }

  it("no file exports dynamic, revalidate or dynamicParams, or says force-static, but the manifest route's one statement", () => {
    expect(offenders(SRC_APP, EXEMPT)).toEqual([]);
  });

  it("the exempt file exists and holds exactly that statement", () => {
    const source = readFileSync(join(SRC_APP, EXEMPT), "utf8");
    expect(source).toMatch(ALLOWED);
    expect(source.replace(ALLOWED, "")).not.toMatch(HATCH);
  });

  it("the exemption is for that file alone: force-static anywhere else is an offender", () => {
    expect(offenders(SRC_APP, "does-not-exist.ts")).toEqual([EXEMPT]);
  });

  describe("on a scratch tree", () => {
    const scratch = (entries: Record<string, string>) => {
      const dir = mkdtempSync(join(tmpdir(), "root-layout-"));
      for (const [name, text] of Object.entries(entries)) {
        mkdirSync(dirname(join(dir, name)), { recursive: true });
        writeFileSync(join(dir, name), text);
      }
      return dir;
    };

    it("the exempt file passes with only the allowed statement", () => {
      const dir = scratch({ [EXEMPT]: 'export const dynamic = "force-static";\n' });
      expect(offenders(dir, EXEMPT)).toEqual([]);
    });

    it.each([
      'export const dynamic = "force-static";\nexport const revalidate = 60;',
      'export const dynamic = "force-static";\nexport const dynamicParams = false;',
      'export const dynamic = "force-dynamic";',
      'export const dynamic = "error";',
    ])("the exempt file still fails with anything else: %s", (text) => {
      expect(offenders(scratch({ [EXEMPT]: text }), EXEMPT)).toEqual([EXEMPT]);
    });

    it("another file with the allowed statement fails", () => {
      const dir = scratch({
        [EXEMPT]: 'export const dynamic = "force-static";',
        "other/page.tsx": 'export const dynamic = "force-static";',
      });
      expect(offenders(dir, EXEMPT)).toEqual(["other/page.tsx"]);
    });
  });
});
