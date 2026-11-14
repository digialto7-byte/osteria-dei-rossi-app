import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COSTI_ICONS, COSTI_PNGS, COSTI_SVG, COSTI_SVGS } from "@/lib/brand/costi-assets";
import { fileURLToPath } from "node:url";

// Costì plan CB5 (§3.5, §3.6): the nine logo slots hold placeholders now and the founder's files later, with no code change. This test is
// what makes a bad or half-done swap fail: every SVG meets the delivery rules, every PNG has its size, and every PNG was rendered from the
// SVG that is in the tree (renders.json holds the sha256 of the source). It has no list of hashes of its own, and it does NOT fail on the
// placeholder marker (the go-live row BRAND-1 does that, not the suite).
const DIR = fileURLToPath(new URL("../../public/brand/costi/", import.meta.url));
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

const SVG_FILES = [
  "app-icon.svg",
  "app-icon-maskable.svg",
  "favicon.svg",
  "logo-horizontal.svg",
  "logo-horizontal-reversed.svg",
  "mark.svg",
  "mark-reversed.svg",
  "wordmark.svg",
  "wordmark-reversed.svg",
] as const;
const SQUARE_SLOTS = ["app-icon.svg", "app-icon-maskable.svg", "favicon.svg"];
const PNG_TABLE = [
  ["icon-192.png", "app-icon.svg", 192],
  ["icon-512.png", "app-icon.svg", 512],
  ["apple-touch-icon.png", "app-icon.svg", 180],
  ["icon-maskable-192.png", "app-icon-maskable.svg", 192],
  ["icon-maskable-512.png", "app-icon-maskable.svg", 512],
  ["favicon-32.png", "favicon.svg", 32],
] as const;

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Delivery rules of §3.5 for one SVG file. `placeholder` is allowed: the marker is checked at go-live, not here. */
function svgViolations(svg: string): string[] {
  const out: string[] = [];
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return ["no root <svg>"];
  if (!/\sviewBox="[^"]+"/.test(root)) out.push("root <svg> has no viewBox");
  if (/<script/i.test(svg)) out.push("<script>");
  if (/<foreignObject/i.test(svg)) out.push("<foreignObject>");
  if (/\son[a-z]+\s*=/i.test(svg)) out.push("on* attribute");
  if (/<image\b/i.test(svg)) out.push("<image>");
  if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(svg)) out.push("external href");
  if (/@import/i.test(svg)) out.push("@import");
  if (/url\(\s*["']?\s*https?:/i.test(svg)) out.push("url(http");
  if (/<text\b/i.test(svg)) out.push("<text> (outline the text)");
  return out;
}

function viewBoxSize(svg: string): [number, number] | null {
  const m = /\sviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Width and height from the IHDR chunk (bytes 16-23), or null when it is not a PNG. */
function pngSize(buf: Buffer): [number, number] | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) return null;
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

interface Renders {
  [png: string]: { source: string; size: number; sha256: string };
}

/** Pngs whose recorded source hash no longer matches the SVG in `dir`. */
function staleRenders(dir: string): string[] {
  const renders = JSON.parse(readFileSync(join(dir, "renders.json"), "utf8")) as Renders;
  return Object.entries(renders)
    .filter(([, r]) => sha256(readFileSync(join(dir, r.source))) !== r.sha256)
    .map(([png]) => png);
}

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );

describe("the nine SVG slots", () => {
  it.each(SVG_FILES)("%s exists and meets the delivery rules", (file) => {
    expect(existsSync(join(DIR, file)), file).toBe(true);
    expect(svgViolations(readFileSync(join(DIR, file), "utf8"))).toEqual([]);
  });

  it.each(SQUARE_SLOTS)("%s has a square viewBox", (file) => {
    const size = viewBoxSize(readFileSync(join(DIR, file), "utf8"));
    expect(size).not.toBeNull();
    expect(size![0]).toBe(size![1]);
  });

  it("holds no SVG other than the nine slots", () => {
    expect(
      readdirSync(DIR)
        .filter((f) => f.endsWith(".svg"))
        .sort(),
    ).toEqual([...SVG_FILES].sort());
  });
});

describe("the six generated PNGs", () => {
  it.each(PNG_TABLE)("%s is a PNG of %s at %i px, square", (file, _source, size) => {
    expect(pngSize(readFileSync(join(DIR, file)))).toEqual([size, size]);
  });

  it("renders.json lists exactly the six PNGs, each with its source slot, size and the sha256 of that SVG", () => {
    const renders = JSON.parse(readFileSync(join(DIR, "renders.json"), "utf8")) as Renders;
    expect(Object.keys(renders).sort()).toEqual(PNG_TABLE.map(([file]) => file).sort());
    for (const [file, source, size] of PNG_TABLE) {
      expect(renders[file]).toEqual({
        source,
        size,
        sha256: sha256(readFileSync(join(DIR, source))),
      });
    }
    expect(staleRenders(DIR)).toEqual([]);
  });

  it("the README lists the sha256 of every SVG and PNG in the folder", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    for (const file of [...SVG_FILES, ...PNG_TABLE.map(([f]) => f)]) {
      expect(readme, file).toContain(sha256(readFileSync(join(DIR, file))));
    }
  });
});

describe("src/lib/brand/costi-assets.ts", () => {
  it("names exactly the nine SVG paths", () => {
    expect([...COSTI_SVGS].sort()).toEqual(SVG_FILES.map((f) => `/brand/costi/${f}`).sort());
    expect(Object.keys(COSTI_SVG).sort()).toEqual(
      [
        "appIcon",
        "appIconMaskable",
        "favicon",
        "logoHorizontal",
        "logoHorizontalReversed",
        "mark",
        "markReversed",
        "wordmark",
        "wordmarkReversed",
      ].sort(),
    );
  });

  it("names exactly the six PNGs with their source slot, size and purpose", () => {
    expect(COSTI_PNGS.map((p) => [p.url, p.source, p.size])).toEqual(
      PNG_TABLE.map(([file, source, size]) => [`/brand/costi/${file}`, source, size]),
    );
    expect(COSTI_ICONS.icon192.purpose).toBe("any");
    expect(COSTI_ICONS.maskable512.purpose).toBe("maskable");
    expect(COSTI_ICONS.appleTouch.purpose).toBe("any");
  });

  it("is the only file in src/ that spells the folder", () => {
    const offenders = files(SRC)
      .filter((f) => /\.(ts|tsx|css)$/.test(f))
      .filter((f) => !f.endsWith("src/lib/brand/costi-assets.ts"))
      .filter((f) => readFileSync(f, "utf8").includes("/brand/costi/"));
    expect(offenders.map((f) => f.slice(SRC.length))).toEqual([]);
  });
});

describe("the checks refuse a bad file (self-tests on fixtures)", () => {
  const ok =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>';

  it("accepts a clean SVG, with or without the placeholder marker", () => {
    expect(svgViolations(ok)).toEqual([]);
    expect(svgViolations(ok.replace("<svg ", '<svg data-costi-placeholder="true" '))).toEqual([]);
  });

  it.each([
    ["script", ok.replace("</svg>", "<script>alert(1)</script></svg>"), "<script>"],
    ["event handler", ok.replace("<svg ", '<svg onload="x()" '), "on* attribute"],
    ["text", ok.replace("</svg>", "<text>Costì</text></svg>"), "<text> (outline the text)"],
    ["foreignObject", ok.replace("</svg>", "<foreignObject/></svg>"), "<foreignObject>"],
    ["image", ok.replace("</svg>", '<image href="#a"/></svg>'), "<image>"],
    [
      "external href",
      ok.replace("</svg>", '<use href="https://x.example/a.svg#b"/></svg>'),
      "external href",
    ],
    ["@import", ok.replace("</svg>", "<style>@import 'a.css';</style></svg>"), "@import"],
    [
      "url(http",
      ok.replace("</svg>", '<rect style="fill:url(http://x.example/a)"/></svg>'),
      "url(http",
    ],
    ["no viewBox", ok.replace(' viewBox="0 0 8 8"', ""), "root <svg> has no viewBox"],
  ])("refuses an SVG with %s", (_name, svg, violation) => {
    expect(svgViolations(svg)).toContain(violation);
  });

  it("allows an internal href (a fragment)", () => {
    expect(svgViolations(ok.replace("</svg>", '<use href="#a"/></svg>'))).toEqual([]);
  });

  it("refuses a PNG with a wrong IHDR, and a file that is not a PNG", () => {
    const real = readFileSync(join(DIR, "icon-192.png"));
    expect(pngSize(real)).toEqual([192, 192]);
    const wrong = Buffer.from(real);
    wrong.writeUInt32BE(100, 16);
    expect(pngSize(wrong)).toEqual([100, 192]);
    expect(pngSize(Buffer.from("not a png at all, just text bytes"))).toBeNull();
  });

  it("a changed SVG byte makes the hash check fail, on a temporary copy", () => {
    const tmp = mkdtempSync(join(tmpdir(), "costi-brand-"));
    for (const f of [...SVG_FILES, "renders.json"]) copyFileSync(join(DIR, f), join(tmp, f));
    expect(staleRenders(tmp)).toEqual([]);
    writeFileSync(
      join(tmp, "app-icon.svg"),
      `${readFileSync(join(tmp, "app-icon.svg"), "utf8")}\n`,
    );
    expect(staleRenders(tmp).sort()).toEqual([
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
    ]);
  });
});
