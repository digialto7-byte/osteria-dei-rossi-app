import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { PRODUCT_THEMES } from "@/lib/design/tokens";

// M20 plan §3.6.6, changed by the Costì plan (CB2, CB6): the product name, the product colours and the four icons (placeholders until the
// founder's logo files arrive; the paths do not change). No shortcuts and start_url "/" are pinned in m25b-preserves.test.ts.
describe("web manifest", () => {
  const m = manifest();

  it("names the product", () => {
    expect(m.name).toBe("Costì");
    expect(m.short_name).toBe("Costì");
  });

  it("is Italian, standalone, and starts at the root", () => {
    expect(m.lang).toBe("it");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
  });

  it("uses the Costì product colours, from PRODUCT_THEMES: Forest theme, Off-white background", () => {
    expect(m.theme_color).toBe("#0E4D3A");
    expect(m.background_color).toBe("#F7F8F6");
    expect(m.theme_color).toBe(PRODUCT_THEMES.light.band);
    expect(m.background_color).toBe(PRODUCT_THEMES.light.paper);
  });

  it("lists exactly the four icons: 192 and 512 any, then 192 and 512 maskable", () => {
    expect(m.icons).toEqual([
      { src: "/brand/costi/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/costi/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/brand/costi/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/costi/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });

  it("each icon's declared size is the size inside the PNG (IHDR), and the file is served from public/", () => {
    expect(m.icons).toHaveLength(4);
    for (const icon of m.icons ?? []) {
      const file = readFileSync(new URL(`../../public${icon.src}`, import.meta.url));
      const size = `${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`;
      expect(icon.sizes).toBe(size);
    }
  });
});
