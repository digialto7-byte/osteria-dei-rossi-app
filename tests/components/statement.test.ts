import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatementView } from "@/app/(owner)/anagrafiche/fornitori/[id]/estratto-conto/statement-view";
import { StatementLink } from "@/app/(owner)/anagrafiche/fornitori/[id]/statement-link";
import { STATEMENT } from "./payable-fixtures";

const NBSP = " ";
const render = (statement = STATEMENT) =>
  renderToStaticMarkup(createElement(StatementView, { statement }));

describe("StatementView", () => {
  it("names the supplier and the as-of date", () => {
    const html = render();
    expect(html).toContain("Estratto conto");
    expect(html).toContain("Fornitore Demo Tre");
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>al 23\/10\/2026<\/p>/);
  });

  it("puts the totals in one dl with a labelled row each, the balance verbatim", () => {
    const html = render();
    const dl = /<dl[\s\S]*?<\/dl>/.exec(html)?.[0] ?? "";
    for (const label of [
      "Fatture aperte",
      "Resi e note di credito",
      "Saldo da pagare",
      "di cui contestate",
    ]) {
      expect(dl).toMatch(new RegExp(`<dt[^>]*>${label}</dt>`));
    }
    expect(dl).toContain(`1.730,00${NBSP}€`);
    expect(dl).toContain(`−70,00${NBSP}€`);
  });

  it("leaves out 'di cui contestate' when nothing is disputed", () => {
    const html = render({ ...STATEMENT, totals: { ...STATEMENT.totals, disputedAmount: 0 } });
    expect(html).not.toContain("di cui contestate");
  });

  it("does no arithmetic: an inconsistent balance is shown as given", () => {
    const html = render({ ...STATEMENT, totals: { ...STATEMENT.totals, balance: 9.99 } });
    expect(html).toContain(`9,99${NBSP}€`);
    expect(html).not.toContain(`1.730,00${NBSP}€`);
  });

  it("lists the open invoices and the credits as the server sent them", () => {
    const html = render();
    expect(html).toContain("Fattura 123/A del 01/12/2026");
    expect(html).toContain(`950,00${NBSP}€`);
    expect(html).toContain("Contestata");
    expect(html).toContain("Fattura 124 del 03/12/2026");
    expect(html).toContain(`−50,00${NBSP}€`);
    expect(html).toContain(`−20,00${NBSP}€`);
  });

  it("the headings of the two lists are real headings", () => {
    const html = render();
    expect(html).toMatch(/<h2[^>]*>Fatture aperte<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>Resi e note di credito<\/h2>/);
  });

  it("without credits the credits list is left out", () => {
    expect(render({ ...STATEMENT, credits: [] })).not.toMatch(/<h2[^>]*>Resi e note di credito/);
  });

  it("an empty statement says so and shows no lists", () => {
    const html = render({
      ...STATEMENT,
      invoices: [],
      credits: [],
      totals: { invoicesTotal: 0, creditsTotal: 0, balance: 0, disputedAmount: 0 },
    });
    expect(html).toContain("Nessuna fattura aperta per questo fornitore.");
    expect(html).not.toContain("<ul");
  });

  it("escapes a supplier name that contains markup and never mentions email", () => {
    const html = render({
      ...STATEMENT,
      supplier: { ...STATEMENT.supplier, name: "<script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/email/i);
  });
});

describe("StatementLink on the supplier page", () => {
  const link = (role: string | null) =>
    renderToStaticMarkup(createElement(StatementLink, { supplierId: "5a0", role }));

  it.each(["owner", "admin"])("is shown to the %s", (role) => {
    expect(link(role)).toMatch(
      /<a[^>]*href="\/anagrafiche\/fornitori\/5a0\/estratto-conto"[^>]*>Estratto conto/,
    );
  });

  it.each(["chef", "waiter", null])("is not shown to %s", (role) => {
    expect(link(role)).toBe("");
  });
});
