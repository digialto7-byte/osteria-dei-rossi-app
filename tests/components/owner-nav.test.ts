import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerNavView } from "@/app/(owner)/owner-nav";

// The "Avvisi" tab follows the same rule as the home link (canReadAlerts): owner and chef only.
const render = (role: string | null, pathname = "/fatture") =>
  renderToStaticMarkup(createElement(OwnerNavView, { role, pathname }));

describe("OwnerNavView", () => {
  it.each(["owner", "chef"])("shows the Avvisi tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/avvisi"[^>]*>Avvisi<\/a>/);
  });

  it.each(["admin", "waiter"])("hides the Avvisi tab from the %s", (role) => {
    const html = render(role);
    expect(html).not.toContain("/avvisi");
    expect(html).not.toContain(">Avvisi<");
  });

  it("hides it until the role is known, and keeps the other tabs", () => {
    const html = render(null);
    expect(html).not.toContain("/avvisi");
    for (const href of ["/", "/fatture", "/anagrafiche/fornitori", "/anagrafiche/importa"])
      expect(html).toContain(`href="${href}"`);
  });

  it("marks Avvisi as the current page on /avvisi", () => {
    expect(render("owner", "/avvisi")).toMatch(/<a[^>]*aria-current="page"[^>]*>Avvisi<\/a>/);
  });

  it.each(["owner", "admin", "chef"])("shows the Ricette tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/ricette"[^>]*>Ricette<\/a>/);
  });

  it("hides the Ricette tab from the waiter and while the role is unknown", () => {
    for (const role of ["waiter", null]) {
      const html = render(role);
      expect(html).not.toContain("/ricette");
      expect(html).not.toContain(">Ricette<");
    }
  });

  it("marks Ricette as the current page on /ricette and below", () => {
    for (const path of ["/ricette", "/ricette/abc/nuova-versione"]) {
      expect(render("chef", path)).toMatch(/<a[^>]*aria-current="page"[^>]*>Ricette<\/a>/);
    }
  });
});
