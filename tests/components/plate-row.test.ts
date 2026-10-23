import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlateRow } from "@/app/(owner)/costi/plate-row";
import type { PlateCost } from "@/server/costing/types";
import { INCOMPLETE_PLATE, PLATE, plainHtml } from "./cost-fixtures";

const render = (plate: PlateCost) =>
  plainHtml(renderToStaticMarkup(createElement("ul", null, createElement(PlateRow, { plate }))));

describe("PlateRow", () => {
  it("links the name to the plate's cost page", () => {
    expect(render(PLATE)).toContain(`href="/costi/ricette/${PLATE.recipeKey}"`);
    expect(render(PLATE)).toContain("Spezzatino con polenta (demo)");
  });

  it("shows the figures in .num lines: 2,06 €, 18,9 % and the GP", () => {
    const html = render(PLATE);
    expect(html).toMatch(
      /<p class="num[^"]*"[^>]*>Costo cibo 2,06 € · Food cost 18,9 % · GP 81,1 % \(obiettivo 70 %\)<\/p>/,
    );
    expect(html).toMatch(
      /<p class="num[^"]*"[^>]*>Prezzo IVA esclusa 10,91 € · Margine lordo 8,85 € · Costo pieno —<\/p>/,
    );
  });

  it("gives the status a word in the badge", () => {
    expect(render(PLATE)).toContain("Costi fissi non ripartiti");
    expect(render({ ...PLATE, status: "below_target" })).toContain("Sotto obiettivo");
    expect(render({ ...PLATE, status: "ok" })).toContain("In linea");
  });

  it("an incomplete plate says which price is missing and shows no cost figure", () => {
    const html = render(INCOMPLETE_PLATE);
    expect(html).toContain("Costo incompleto");
    expect(html).toContain("Manca il prezzo di: Sale grosso (demo)");
    expect(html).not.toContain("Costo cibo");
    expect(html).not.toContain("0,00");
  });

  it("escapes a name that contains markup", () => {
    const html = render({ ...PLATE, name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
