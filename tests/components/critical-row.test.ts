import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CriticalRow } from "@/app/(owner)/magazzino/conteggi/critici/critical-row";
import { ING } from "./count-fixtures";

const render = (over: Partial<Parameters<typeof CriticalRow>[0]["item"]> = {}, busy = false) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(CriticalRow, {
        item: {
          ingredientId: ING,
          name: "Manzo muscolo (demo)",
          baseUnit: "kg",
          isCritical: false,
          ...over,
        },
        busy,
        onChange: () => undefined,
      }),
    ),
  );

describe("CriticalRow", () => {
  it("is a labelled checkbox in a 44 px row", () => {
    const html = render();
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toMatch(/<label[^>]*min-h-tap[^>]*>[\s\S]*Manzo muscolo \(demo\)/);
  });
  it("is checked when the server says it is critical", () => {
    expect(render({ isCritical: true })).toMatch(/<input[^>]*checked=""/);
    expect(render()).not.toMatch(/checked=""/);
  });
  it("is disabled while a change is being saved", () => {
    expect(render({}, true)).toMatch(/<input[^>]*disabled=""/);
  });
  it("escapes a name that contains markup and shows no euro sign", () => {
    const html = render({ name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("€");
  });
});
