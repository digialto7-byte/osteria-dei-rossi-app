import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BatchFacts } from "@/app/(owner)/produzione/[id]/batch-facts";
import type { BatchDetail } from "@/server/batches/types";
import { BATCH_DETAIL, CHILD_ID, BATCH_ID } from "./batch-fixtures";

const render = (over: Partial<BatchDetail> = {}, locale?: "it" | "en") =>
  renderToStaticMarkup(
    createElement(BatchFacts, {
      detail: { ...BATCH_DETAIL, ...over },
      ...(locale ? { locale } : {}),
    }),
  );

describe("BatchFacts", () => {
  it("shows the lot code in .num and what is left of what was made", () => {
    const html = render();
    expect(html).toMatch(/<dd[^>]*class="num[^"]*"[^>]*>261023-RAGUDE-2<\/dd>/);
    expect(html).toContain("Rimaste 6 di 10 porzioni");
  });

  it("writes the instants in Europe/Rome and names the location", () => {
    const html = render();
    expect(html).toContain("23/10/2026 12:12");
    expect(html).toContain("26/10/2026 11:12");
    expect(html).toContain("Cella (demo)");
  });

  it("words the state: Aperto, Finito, Scartato; a fresh batch shows none", () => {
    expect(render({ state: "open" })).toMatch(/>Aperto</);
    expect(render({ state: "finished", portionsRemaining: 0 })).toMatch(/>Finito</);
    expect(render({ state: "discarded", portionsRemaining: 0 })).toMatch(/>Scartato</);
    const fresh = render({ state: "fresh" });
    for (const word of ["Aperto", "Finito", "Scartato"]) expect(fresh).not.toContain(word);
  });

  it("badges an expired and a due-soon batch", () => {
    expect(render({ useByState: "expired" })).toMatch(/bg-danger-bg[^>]*>[\s\S]*Scaduto</);
    expect(render({ useByState: "due_soon" })).toMatch(/bg-warning-bg[^>]*>[\s\S]*In scadenza</);
  });

  it("links a split part to its parent: 'Diviso da <lot>'", () => {
    const html = render({ splitFrom: { batchId: BATCH_ID, lotCode: "261023-RAGUDE-1" } });
    expect(html).toMatch(
      new RegExp(`Diviso da\\s*<a[^>]*href="/produzione/${BATCH_ID}"[^>]*>261023-RAGUDE-1</a>`),
    );
    expect(render()).not.toContain("Diviso da");
  });

  it("lists the parts split off, with portions and location, each a link to the part", () => {
    const html = render();
    expect(html).toContain("Parti divise");
    expect(html).toMatch(
      new RegExp(
        `<a[^>]*href="/produzione/${CHILD_ID}"[^>]*>261024-RAGUDE-3 · 4 porzioni · Congelatore \\(demo\\)</a>`,
      ),
    );
    expect(render({ splits: [] })).not.toContain("Parti divise");
  });

  it("has English words and escapes markup in the recipe name", () => {
    expect(render({}, "en")).toContain("Left 6 of 10 portions");
    const html = render({ recipeName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
  });

  it("shows no euro sign", () => {
    expect(render()).not.toContain("€");
  });
});
