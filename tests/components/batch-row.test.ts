import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BatchRow, type BatchRowItem } from "@/app/(owner)/produzione/batch-row";
import { BATCH_ID, BATCH_ITEM } from "./batch-fixtures";

const render = (over: Partial<BatchRowItem> = {}, locale?: "it" | "en") =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(BatchRow, { item: { ...BATCH_ITEM, ...over }, ...(locale ? { locale } : {}) }),
    ),
  );

describe("BatchRow", () => {
  it("shows the recipe in bold and the lot code in .num", () => {
    const html = render();
    expect(html).toMatch(/<p class="[^"]*font-bold[^"]*">Spezzatino \(demo\)<\/p>/);
    expect(html).toMatch(/<p class="num[^"]*">261023-SPEZZA-1<\/p>/);
  });

  it("writes the produced and use-by instants in Europe/Rome", () => {
    expect(render()).toMatch(
      /<p class="num[^"]*">Prodotto il 23\/10\/2026, 12:12 · da consumare entro il 26\/10\/2026, 11:12<\/p>/,
    );
  });

  it("shows the portions and what is left", () => {
    expect(render()).toContain("31 porzioni · rimaste 31");
    expect(render({ portionsInitial: 1, portionsComputed: 1, portionsRemaining: 0.5 })).toContain(
      "1 porzione · rimaste 0,5",
    );
  });

  it("says what was computed only when the chef changed the portions", () => {
    expect(render()).not.toContain("calcolate");
    const html = render({ portionsInitial: 30, portionsComputed: 31 });
    expect(html).toContain("30 porzioni");
    expect(html).toContain("(calcolate 31)");
  });

  it("badges an expired and a due-soon batch with the words", () => {
    expect(render({ useByState: "expired" })).toMatch(/bg-danger-bg[^>]*>[\s\S]*Scaduto</);
    expect(render({ useByState: "due_soon" })).toMatch(/bg-warning-bg[^>]*>[\s\S]*In scadenza</);
    const ok = render();
    expect(ok).not.toContain("Scaduto");
    expect(ok).not.toContain("In scadenza");
  });

  it("writes \"tu\" for the reader's own batch and the initials for a colleague's", () => {
    expect(render({ byMe: true })).toContain("· tu");
    expect(render({ byMe: true })).not.toContain("· CD");
    expect(render({ byMe: false })).toContain("· CD");
  });

  it("links to the label", () => {
    expect(render()).toMatch(
      new RegExp(`<a[^>]*href="/produzione/${BATCH_ID}/etichetta"[^>]*>Etichetta</a>`),
    );
  });

  it("shows the frozen cost to the owner and the admin (an item with a cost)", () => {
    const html = render({ cost: { totalEur: 53.5167, perPortionEur: 1.7263, incomplete: false } });
    expect(html).toContain("Costo 53,52 € · 1,73 € a porzione");
  });

  it("an incomplete cost says so and never shows 0,00 €", () => {
    const html = render({ cost: { totalEur: null, perPortionEur: null, incomplete: true } });
    expect(html).toContain("Costo incompleto: manca il prezzo di un ingrediente");
    expect(html).not.toMatch(/0,00/);
    expect(html).not.toContain("€");
  });

  it("without a cost (the chef's list) the markup has no euro sign at all", () => {
    expect(render()).not.toContain("€");
    expect(render()).not.toContain("Costo");
  });

  it("has English words and escapes a recipe name that contains markup", () => {
    expect(render({}, "en")).toContain("Produced on 23/10/2026, 12:12 · use by 26/10/2026, 11:12");
    const html = render({ recipeName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("links to the batch with 'Apri', next to the label link", () => {
    expect(render()).toMatch(new RegExp(`<a[^>]*href="/produzione/${BATCH_ID}"[^>]*>Apri</a>`));
  });

  it("badges an open, a finished and a discarded batch with the words; a fresh one has none", () => {
    expect(render({ state: "open" })).toMatch(/>Aperto</);
    expect(render({ state: "finished" })).toMatch(/>Finito</);
    expect(render({ state: "discarded" })).toMatch(/>Scartato</);
    const fresh = render({ state: "fresh" });
    for (const word of ["Aperto", "Finito", "Scartato"]) expect(fresh).not.toContain(word);
  });

  it("has an English 'Open' link", () => {
    expect(render({}, "en")).toMatch(/>Open</);
  });
});
