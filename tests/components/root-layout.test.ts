import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-test" }) }));

const { viewport } = await import("@/app/layout");

// The browser chrome continues the venue band: both schemes take the venue's band colour (ADR-045), from the venue layer.
describe("root viewport", () => {
  it("has a theme-color for light and for dark, both the venue's band #1C4130", () => {
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#1C4130" },
      { media: "(prefers-color-scheme: dark)", color: "#1C4130" },
    ]);
  });
});
