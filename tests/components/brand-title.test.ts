import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandTitle } from "@/components/brand";

// QW1 (docs/plans/2026-11-13-ux-quick-wins.md): on the guest booking page the venue name is not a link, because "/" sends a signed-out
// guest to the staff sign-in and loses the typed form.
describe("BrandTitle (the wordmark with no link)", () => {
  const html = renderToStaticMarkup(createElement(BrandTitle));

  it("renders no link", () => {
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("shows the wordmark and the brand mark", () => {
    expect(html).toContain("Osteria Dei Rossi");
    expect(html).toContain('data-slot="brand-mark"');
  });

  it("is at least 44 px tall, like the link, so the band does not change height", () => {
    expect(html).toMatch(/class="[^"]*min-h-tap/);
  });
});
