import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiningTableRow } from "@/app/(owner)/tavoli/impostazioni/dining-table-row";
import { DINING_TABLES } from "../helpers/menu-tables-data";

type Props = Parameters<typeof DiningTableRow>[0];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(DiningTableRow, {
      table: DINING_TABLES[1]!,
      busy: false,
      error: null,
      onSave: () => undefined,
      ...over,
    }),
  );

describe("DiningTableRow", () => {
  it("is a named group with the name, the order, Rinomina and the Attivo switch", () => {
    const html = render();
    expect(html).toMatch(
      /role="group"[^>]*aria-label="Tavolo 2 \(demo\)"|aria-label="Tavolo 2 \(demo\)"[^>]*role="group"/,
    );
    expect(html).toMatch(/<[^>]*font-bold[^>]*>Tavolo 2 \(demo\)</);
    expect(html).toMatch(/<[^>]*class="num[^"]*"[^>]*>2</);
    expect(html).toMatch(/<button[^>]*>Rinomina<\/button>/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(html).toContain("Attivo");
  });

  it("an inactive table has the switch off", () => {
    const html = render({ table: { ...DINING_TABLES[1]!, active: false } });
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
  });

  it("a table with an open session says Aperto", () => {
    expect(render({ table: DINING_TABLES[0]! })).toContain("Aperto");
    expect(render()).not.toContain("Aperto");
  });

  it("shows the error of the last save, such as the open table", () => {
    expect(render({ error: "Chiudi prima il tavolo aperto." })).toContain(
      "Chiudi prima il tavolo aperto.",
    );
  });

  it("disables the controls while saving", () => {
    expect(render({ busy: true })).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
  });

  it("renders a name with markup as text", () => {
    const html = render({ table: { ...DINING_TABLES[1]!, name: "<b>x</b>" } });
    expect(html).not.toContain("<b>x</b>");
  });
});
