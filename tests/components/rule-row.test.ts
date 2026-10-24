import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuleRow } from "@/app/(owner)/produzione/personale/rule-row";
import type { StaffMealRuleItem } from "@/server/staff-meals/types";
import { CONFIRMED_TODAY, PANE_RULE, RAGU_RULE } from "./batch-fixtures";

const render = (
  rule: StaffMealRuleItem = RAGU_RULE,
  over: Partial<Parameters<typeof RuleRow>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(RuleRow, {
        rule,
        busy: false,
        error: null,
        onConfirm: async () => true,
        onToggle: () => {},
        ...over,
      }),
    ),
  );
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1]!,
    text: m[2]!.replace(/<[^>]*>/g, ""),
  }));

describe("RuleRow, before today's meal", () => {
  it("words the rule and the portions available for a recipe", () => {
    const html = render();
    expect(html).toContain("Ragù (demo) · 2 porzioni");
    expect(html).toContain("Disponibili: 6");
  });

  it("words an ingredient rule with its unit and shows no availability", () => {
    const html = render(PANE_RULE);
    expect(html).toContain("Pane (demo) · 0,5 kg");
    expect(html).not.toContain("Disponibili");
  });

  it("has one primary button 'Conferma pasto di oggi', which is 44 px tall", () => {
    const html = render();
    const primary = buttons(html).filter(
      (b) => b.attrs.includes("bg-accent") && !b.attrs.includes("border-ink"),
    );
    expect(primary.map((b) => b.text)).toEqual(["Conferma pasto di oggi"]);
    expect(primary[0]!.attrs).toContain("min-h-tap");
  });

  it("offers 'Cambia quantità' and 'Disattiva' as quiet text buttons, no other primary", () => {
    const texts = buttons(render()).map((b) => b.text);
    expect(texts).toEqual(["Conferma pasto di oggi", "Cambia quantità", "Disattiva"]);
  });

  it("opens the quantity of today, prefilled, with the unit as a hint", () => {
    const html = render(PANE_RULE, { initialChanging: true });
    expect(html).toMatch(/<span[^>]*>Quantità di oggi<\/span>/);
    expect(html).toMatch(/<input[^>]*inputMode="decimal"[^>]*value="0,5"/);
    expect(html).toContain("In kg.");
  });

  it("disables the buttons while a request is on its way", () => {
    expect(render(RAGU_RULE, { busy: true })).toMatch(
      /<button[^>]*disabled=""[^>]*>Conferma pasto di oggi<\/button>/,
    );
  });

  it("names the rule for the buttons (aria-describedby points at the name)", () => {
    const html = render();
    const id = /<p id="([^"]+)"[^>]*>Ragù \(demo\) · 2 porzioni<\/p>/.exec(html)![1]!;
    expect(html).toContain(`aria-describedby="${id}"`);
  });
});

describe("RuleRow, after today's meal", () => {
  const confirmed = { ...RAGU_RULE, today: CONFIRMED_TODAY };

  it("says when and who, and offers no confirm button", () => {
    const html = render(confirmed);
    expect(html).toContain("Confermato alle 12:10 · CD");
    expect(buttons(html).map((b) => b.text)).not.toContain("Conferma pasto di oggi");
    expect(html).not.toContain("Cambia quantità");
  });

  it("words the English line", () => {
    expect(render(confirmed, { locale: "en" })).toContain("Confirmed at 12:10 · CD");
  });
});

describe("RuleRow, an inactive rule", () => {
  const inactive = { ...RAGU_RULE, isActive: false };

  it("is marked 'Disattivata', has no confirm button and offers 'Riattiva'", () => {
    const html = render(inactive);
    expect(html).toContain("Disattivata");
    expect(buttons(html).map((b) => b.text)).toEqual(["Riattiva"]);
  });
});

describe("RuleRow, errors", () => {
  it("shows 'Già confermato per oggi.' from the server in an alert", () => {
    const html = render(RAGU_RULE, { error: "Già confermato per oggi." });
    expect(html).toMatch(/<p role="alert"[^>]*>Già confermato per oggi\.<\/p>/);
  });

  it("escapes markup in the name", () => {
    const html = render({ ...RAGU_RULE, name: "<script>x</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows no euro sign", () => {
    expect(render()).not.toContain("€");
    expect(render(PANE_RULE)).not.toContain("€");
  });
});
