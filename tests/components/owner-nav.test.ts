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

  it.each(["owner", "admin"])("shows the Pagamenti tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/pagamenti"[^>]*>Pagamenti<\/a>/);
  });

  it("hides the Pagamenti tab from the chef, the waiter and an unknown role", () => {
    for (const role of ["chef", "waiter", null]) {
      const html = render(role);
      expect(html).not.toContain("/pagamenti");
      expect(html).not.toContain(">Pagamenti<");
    }
  });

  it("marks Pagamenti as the current page on /pagamenti and below", () => {
    for (const path of ["/pagamenti", "/pagamenti/abc"]) {
      expect(render("owner", path)).toMatch(/<a[^>]*aria-current="page"[^>]*>Pagamenti<\/a>/);
    }
  });

  it.each(["owner", "admin"])("shows the Costi tab to the %s, never the Margini tab", (role) => {
    const html = render(role);
    expect(html).toMatch(/<a[^>]*href="\/costi"[^>]*>Costi<\/a>/);
    expect(html).not.toContain("/margini");
    expect(html).not.toContain(">Margini<");
  });

  it("shows the Margini tab to the chef, never the Costi tab", () => {
    const html = render("chef");
    expect(html).toMatch(/<a[^>]*href="\/margini"[^>]*>Margini<\/a>/);
    expect(html).not.toContain("/costi");
    expect(html).not.toContain(">Costi<");
  });

  it("shows neither to the waiter or while the role is unknown", () => {
    for (const role of ["waiter", null]) {
      const html = render(role);
      expect(html).not.toContain("/costi");
      expect(html).not.toContain("/margini");
    }
  });

  it("marks Costi as current on /costi and below, Margini on /margini", () => {
    for (const path of ["/costi", "/costi/ingredienti", "/costi/ricette/abc"]) {
      expect(render("owner", path)).toMatch(/<a[^>]*aria-current="page"[^>]*>Costi<\/a>/);
    }
    expect(render("chef", "/margini")).toMatch(/<a[^>]*aria-current="page"[^>]*>Margini<\/a>/);
  });

  it.each(["owner", "admin", "chef"])("shows the Magazzino tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/magazzino"[^>]*>Magazzino<\/a>/);
  });

  it("hides the Magazzino tab from the waiter and while the role is unknown", () => {
    for (const role of ["waiter", null]) {
      const html = render(role);
      expect(html).not.toContain("/magazzino");
      expect(html).not.toContain(">Magazzino<");
    }
  });

  it("marks Magazzino as the current page on /magazzino and below, and no other tab", () => {
    for (const path of ["/magazzino", "/magazzino/abc", "/magazzino/sprechi"]) {
      const html = render("owner", path);
      expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Magazzino<\/a>/);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    }
  });

  it.each(["owner", "admin", "chef"])("shows the Produzione tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/produzione"[^>]*>Produzione<\/a>/);
  });

  it("hides the Produzione tab from the waiter and while the role is unknown", () => {
    for (const role of ["waiter", null]) {
      const html = render(role);
      expect(html).not.toContain("/produzione");
      expect(html).not.toContain(">Produzione<");
    }
  });

  it("marks Produzione as the current page on /produzione and below", () => {
    for (const path of ["/produzione", "/produzione/nuova", "/produzione/abc/etichetta"]) {
      expect(render("chef", path)).toMatch(/<a[^>]*aria-current="page"[^>]*>Produzione<\/a>/);
    }
  });
});

describe("Personale tab (M11)", () => {
  it.each(["owner", "admin"])("shows the Personale tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/personale"[^>]*>Personale<\/a>/);
  });

  it.each(["chef", "waiter", "unknown", null])("hides it from %s", (role) => {
    const html = render(role);
    expect(html).not.toContain("/personale");
    expect(html).not.toContain(">Personale<");
  });

  it("marks it current on /personale and below", () => {
    expect(render("owner", "/personale")).toMatch(/<a[^>]*aria-current="page"[^>]*>Personale<\/a>/);
  });
});

describe("OwnerNavView, Riordino", () => {
  it.each(["owner", "admin", "chef"])("shows the Riordino tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/riordino"[^>]*>Riordino<\/a>/);
  });

  it("hides the Riordino tab from the waiter and while the role is unknown", () => {
    for (const role of ["waiter", null]) {
      const html = render(role);
      expect(html).not.toContain("/riordino");
      expect(html).not.toContain(">Riordino<");
    }
  });

  it("marks Riordino as the current page on /riordino and below, and only there", () => {
    for (const path of ["/riordino", "/riordino/fornitori", "/riordino/ricette"]) {
      expect(render("owner", path)).toMatch(/<a[^>]*aria-current="page"[^>]*>Riordino<\/a>/);
    }
    expect(render("owner", "/fatture")).not.toMatch(/aria-current="page"[^>]*>Riordino</);
  });

  it("keeps the existing tabs", () => {
    const html = render("chef");
    for (const href of ["/", "/fatture", "/avvisi", "/ricette", "/magazzino", "/produzione"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  // M17: Tavoli follows canUseTables (owner, admin, waiter), Menu follows canEditMenu (owner, admin).
  it.each(["owner", "admin", "waiter"])("shows the Tavoli tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/tavoli"[^>]*>Tavoli<\/a>/);
  });

  it("hides the Tavoli tab from the chef and while the role is unknown", () => {
    for (const role of ["chef", null]) {
      const html = render(role);
      expect(html).not.toContain("/tavoli");
      expect(html).not.toContain(">Tavoli<");
    }
  });

  it.each(["owner", "admin"])("shows the Menu tab to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/menu"[^>]*>Menu<\/a>/);
  });

  it("hides the Menu tab from the waiter, the chef and an unknown role", () => {
    for (const role of ["waiter", "chef", null]) {
      const html = render(role);
      expect(html).not.toContain('href="/menu"');
      expect(html).not.toMatch(/>Menu<\/a>/);
    }
  });

  it("marks Tavoli on /tavoli and on /tavoli/impostazioni, and Menu on /menu only", () => {
    for (const path of ["/tavoli", "/tavoli/impostazioni"]) {
      const html = render("owner", path);
      expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Tavoli<\/a>/);
      expect(html).not.toMatch(/<a[^>]*aria-current="page"[^>]*>Menu<\/a>/);
    }
    expect(render("owner", "/menu")).toMatch(/<a[^>]*aria-current="page"[^>]*>Menu<\/a>/);
    expect(render("owner", "/menu")).not.toMatch(/<a[^>]*aria-current="page"[^>]*>Tavoli<\/a>/);
  });

  it.each(["owner", "admin", "chef"])("shows the Cucina tab to the %s (M19)", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/cucina"[^>]*>Cucina<\/a>/);
  });

  it("hides the Cucina tab from the waiter and while the role is unknown", () => {
    for (const role of ["waiter", null]) {
      const html = render(role);
      expect(html).not.toContain("/cucina");
      expect(html).not.toContain(">Cucina<");
    }
  });

  it("marks Cucina as the current page on /cucina", () => {
    expect(render("chef", "/cucina")).toMatch(/<a[^>]*aria-current="page"[^>]*>Cucina<\/a>/);
  });
});
