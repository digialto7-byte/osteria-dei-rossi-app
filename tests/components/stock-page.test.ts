import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StockLinks } from "@/app/(owner)/magazzino/stock-links";
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

// The count and activity links of the /magazzino header follow canCount / canReadAudit (src/lib/counts/count-view.ts).
describe("the /magazzino header links to the counts, the reconciliation and the activity log (M13)", () => {
  const links = (role: string | null) => renderToStaticMarkup(createElement(StockLinks, { role }));

  it.each(["owner", "admin", "chef"])("%s sees Conteggi and Riconciliazione", (role) => {
    expect(links(role)).toMatch(/<a[^>]*href="\/magazzino\/conteggi"[^>]*>Conteggi<\/a>/);
    expect(links(role)).toMatch(
      /<a[^>]*href="\/magazzino\/riconciliazione"[^>]*>Riconciliazione<\/a>/,
    );
  });

  it.each(["owner", "admin"])("%s also sees Registro attività", (role) => {
    expect(links(role)).toMatch(/<a[^>]*href="\/registro"[^>]*>Registro attività<\/a>/);
  });

  it("the chef does not see the activity log", () => {
    expect(links("chef")).not.toContain("Registro attività");
  });

  it.each(["waiter", "unknown", null])("%s sees none of them", (role) => {
    expect(links(role)).toBe("");
  });
});
