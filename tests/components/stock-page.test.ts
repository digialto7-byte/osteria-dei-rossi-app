import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WasteCostsLink } from "@/app/(owner)/magazzino/waste-costs-link";

const render = (role: string | null) =>
  renderToStaticMarkup(createElement(WasteCostsLink, { role }));

// The "Sprechi in €" link of the /magazzino header follows canReadWasteCosts (src/lib/stock/stock-view.ts): the euro
// value of the waste is for owner and admin only (Q16 = V6).
describe("the /magazzino header link to the waste in EUR", () => {
  it.each(["owner", "admin"])("is shown to the %s", (role) => {
    expect(render(role)).toMatch(/<a[^>]*href="\/magazzino\/sprechi"[^>]*>Sprechi in €<\/a>/);
  });

  it.each(["chef", "waiter", "unknown", null])("is not shown to %s", (role) => {
    expect(render(role)).toBe("");
  });
});
