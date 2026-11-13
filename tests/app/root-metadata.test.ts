import { describe, expect, it, vi } from "vitest";

// Costì plan CB6: the favicon and the apple-touch icon are in the root metadata, so every page gets them. They are plain files in public/ (not the
// app/icon.* conventions, so the pre-rendered route list stays as it is).
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-test" }) }));

const { metadata } = await import("@/app/layout");

describe("root metadata", () => {
  it("the tab title is the product, Costì", () => {
    expect(metadata.title).toBe("Costì");
  });

  it("the favicon is the SVG first and the 32 px PNG as fallback", () => {
    expect(metadata.icons).toMatchObject({
      icon: [
        { url: "/brand/costi/favicon.svg", type: "image/svg+xml" },
        { url: "/brand/costi/favicon-32.png", sizes: "32x32", type: "image/png" },
      ],
    });
    const icons = metadata.icons as { icon: unknown[] };
    expect(icons.icon).toHaveLength(2);
  });

  it("the apple-touch icon is the 180 px PNG", () => {
    const icons = metadata.icons as { apple: unknown[] };
    expect(icons.apple).toEqual([
      { url: "/brand/costi/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ]);
  });
});
