import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeCard } from "@/app/(owner)/dispositivi/code-card";

const ADDRESS = "app.example.test/dispositivo";
const render = () =>
  renderToStaticMarkup(
    createElement(CodeCard, {
      display: "K7M2-QX9P",
      label: "Telefono sala (demo)",
      expiresAt: "2026-10-24T17:17:00Z",
      address: ADDRESS,
    }),
  );

describe("CodeCard", () => {
  it("shows the code large in .num", () => {
    expect(render()).toMatch(/<p class="num[^"]*"[^>]*>K7M2-QX9P<\/p>/);
  });
  it("says when it expires (Europe/Rome) and what to do", () => {
    expect(render()).toContain("Scade alle 19:17. Inseriscilo nel dispositivo da abilitare.");
  });
  it("names the device and is announced", () => {
    const html = render();
    expect(html).toContain("Telefono sala (demo)");
    expect(html).toContain('role="status"');
  });

  it("says where to type it: the address of the page, as the owner's phone sees it", () => {
    expect(render()).toContain("Sul telefono da abilitare apri app.example.test/dispositivo");
  });
  it("never puts the code in a link or an attribute", () => {
    const html = render();
    expect(html).not.toMatch(/href="[^"]*K7M2/);
    expect(html).not.toMatch(/="[^"]*K7M2/);
    expect(html).not.toMatch(/="[^"]*QX9P/);
    expect(html).not.toContain("<a ");
  });
});
