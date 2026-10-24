import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MenuItemCard } from "@/app/(owner)/menu/menu-item-card";
import { IDS, MAPPED_ITEM, UNMAPPED_ITEM } from "../helpers/menu-tables-data";

type Props = Parameters<typeof MenuItemCard>[0];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(MenuItemCard, { item: MAPPED_ITEM, onEdit: () => undefined, ...over }),
  );

describe("MenuItemCard", () => {
  it("is a named group carrying the item id, so a screen reader and a test can scope to it", () => {
    const html = render();
    expect(html).toMatch(/role="group"/);
    expect(html).toContain('aria-label="Spezzatino con polenta (demo)"');
    expect(html).toContain(`data-menu-item-id="${IDS.item}"`);
  });

  it("shows the name in bold, the price and VAT in a .num line, and the course word", () => {
    const html = render();
    expect(html).toMatch(/<[^>]*font-bold[^>]*>Spezzatino con polenta \(demo\)</);
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>14,00\s€ · IVA 10 %<\/p>/);
    expect(html).toContain("Secondi");
  });

  it("a mapped item has no badge and names its recipe", () => {
    const html = render();
    expect(html).not.toContain("Senza ricetta");
    expect(html).not.toContain("Ricetta disattivata");
    expect(html).toContain("Ricetta: Spezzatino con polenta (demo)");
  });

  it("an unmapped item says Senza ricetta (AT5) and names no recipe", () => {
    const html = render({ item: UNMAPPED_ITEM });
    expect(html).toContain("Senza ricetta");
    expect(html).not.toContain("Ricetta:");
    expect(html).toMatch(/2,00\s€ · IVA 10 %/);
  });

  it("a deactivated recipe, an unavailable and an inactive item are flagged", () => {
    expect(render({ item: { ...MAPPED_ITEM, recipeActive: false } })).toContain(
      "Ricetta disattivata",
    );
    expect(render({ item: { ...MAPPED_ITEM, available: false } })).toContain("Non disponibile");
    expect(render({ item: { ...MAPPED_ITEM, active: false } })).toContain("Non attivo");
  });

  it("renders a name with markup as text", () => {
    const html = render({ item: { ...MAPPED_ITEM, name: "<script>alert(1)</script>" } });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("has a Modifica button of at least 44 px", () => {
    expect(render()).toMatch(/<button[^>]*min-h-tap[^>]*>Modifica<\/button>/);
  });

  it("shows the price exactly as the server gave it, grouped and with two decimals", () => {
    expect(render({ item: { ...MAPPED_ITEM, price: 1234.5 } })).toMatch(/1\.234,50\s€/);
  });
});
