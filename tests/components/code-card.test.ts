import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeCard } from "@/app/(owner)/dispositivi/code-card";

const render = () =>
  renderToStaticMarkup(
    createElement(CodeCard, {
      display: "K7M2-QX9P",
      label: "Telefono sala (demo)",
      expiresAt: "2026-10-24T17:17:00Z",
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
});
