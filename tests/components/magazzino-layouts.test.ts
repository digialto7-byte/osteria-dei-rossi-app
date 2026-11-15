// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MagazzinoLayout from "@/app/(owner)/magazzino/layout";
import TracciabilitaLayout from "@/app/(owner)/tracciabilita/layout";

// P2f-2 (ADR-045): the two roots of step 5 wear the Costì look through their group layout. A layout wraps every state of its pages (loaded,
// loading, error), so one marker here covers them all; the child stays a sibling, so the page's own markup is not wrapped.
describe.each([
  ["magazzino", MagazzinoLayout],
  ["tracciabilita", TracciabilitaLayout],
])("the %s layout", (_name, Layout) => {
  it("renders the Costì marker once, before its children", () => {
    const html = renderToStaticMarkup(
      createElement(Layout, null, createElement("p", null, "pagina")),
    );
    expect(html).toBe('<span data-brand="costi" hidden=""></span><p>pagina</p>');
  });
});
