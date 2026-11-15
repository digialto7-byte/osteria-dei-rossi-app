// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChiusuraLayout from "@/app/(owner)/chiusura/layout";
import PrenotazioniLayout from "@/app/(owner)/prenotazioni/layout";
import ReportLayout from "@/app/(owner)/report/layout";

// P2g-1 (ADR-045): the three roots of step 6 wear the Costì look through their group layout. A layout wraps every state of its pages (loaded,
// loading, error, and the nested /report/mese), so one marker here covers them all; the child stays a sibling, so the page's markup is not wrapped.
describe.each([
  ["chiusura", ChiusuraLayout],
  ["prenotazioni", PrenotazioniLayout],
  ["report", ReportLayout],
])("the %s layout", (_name, Layout) => {
  it("renders the Costì marker once, before its children", () => {
    const html = renderToStaticMarkup(
      createElement(Layout, null, createElement("p", null, "pagina")),
    );
    expect(html).toBe('<span data-brand="costi" hidden=""></span><p>pagina</p>');
  });
});
