import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountSessionRow } from "@/app/(owner)/magazzino/conteggi/count-session-row";
import type { CountSession } from "@/server/counts/types";
import { SESSION, SESSION_ID } from "./count-fixtures";

const render = (over: Partial<CountSession> = {}) =>
  renderToStaticMarkup(
    createElement("ul", null, createElement(CountSessionRow, { session: { ...SESSION, ...over } })),
  );

describe("CountSessionRow", () => {
  it("shows the type word, the location and a neutral 'Chiuso' badge", () => {
    const html = render();
    expect(html).toContain("Giornaliero");
    expect(html).toContain("Cella (demo)");
    expect(html).toMatch(/bg-sunk[^>]*>[\s\S]*Chiuso</);
  });

  it("an open count has an info badge 'In corso' and a cancelled one a neutral 'Annullato'", () => {
    expect(render({ status: "open", closedAt: null, closedBy: null })).toMatch(
      /bg-info-bg[^>]*>[\s\S]*In corso</,
    );
    expect(render({ status: "cancelled", closedAt: null, closedBy: null })).toContain("Annullato");
  });

  it("the meta line is .num with the Rome time and the person", () => {
    expect(render()).toMatch(/<p class="num[^"]*"[^>]*>23\/10\/2026, 10:12 · Chef Demo<\/p>/);
  });

  it("says 'tu' for the viewer and 'un collega' when the name is hidden", () => {
    expect(render({ startedBy: { name: "Chef Demo", me: true } })).toContain("· tu");
    expect(render({ startedBy: { name: null, me: false } })).toContain("· un collega");
  });

  it("shows the number of differences the server counted, in the singular and the plural", () => {
    expect(render()).toContain("3 differenze");
    expect(render({ linesWithDifference: 1 })).toContain("1 differenza");
    expect(render({ linesWithDifference: 0 })).toContain("0 differenze");
  });

  it("links to the variance only when the count is closed", () => {
    expect(render()).toContain(`href="/magazzino/conteggi/${SESSION_ID}/scostamenti"`);
    expect(render({ status: "open", closedAt: null, closedBy: null })).not.toContain("scostamenti");
    expect(render({ status: "cancelled", closedAt: null, closedBy: null })).not.toContain(
      "Scostamenti",
    );
  });

  it("shows no euro sign", () => {
    expect(render()).not.toContain("€");
  });

  it("shows a counter that does not add up as given (nothing is computed here)", () => {
    const html = render({ linesTotal: 2, linesCounted: 9, linesWithDifference: 7 });
    expect(html).toContain("7 differenze");
  });
});
