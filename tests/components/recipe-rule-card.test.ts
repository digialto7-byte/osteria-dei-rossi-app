import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecipeRuleCard } from "@/app/(owner)/riordino/recipe-rule-card";
import { RECIPE } from "./rules-fixtures";

type Props = Parameters<typeof RecipeRuleCard>[0];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(RecipeRuleCard, {
      item: RECIPE,
      canEdit: true,
      busy: false,
      error: null,
      onSave: () => undefined,
      ...over,
    }),
  );

describe("RecipeRuleCard, owner", () => {
  it("shows the name in bold and how many portions are left", () => {
    const html = render();
    expect(html).toMatch(/<[^>]*font-bold[^>]*>Spezzatino \(demo\)</);
    expect(html).toMatch(/<p class="num[^"]*"[^>]*>Restano 4 porzioni<\/p>/);
  });

  it("says Resta 1 porzione for one", () => {
    expect(render({ item: { ...RECIPE, remainingPortions: 1 } })).toContain("Resta 1 porzione");
  });

  it("has the three numeric fields with their values", () => {
    const html = render();
    expect(html).toMatch(/Porzioni minime[\s\S]*?<input[^>]*inputMode="numeric"[^>]*value="5"/i);
    expect(html).toMatch(
      /Porzioni obiettivo[\s\S]*?<input[^>]*inputMode="numeric"[^>]*value="30"/i,
    );
    expect(html).toMatch(
      /Tempo di preparazione \(min\)[\s\S]*?<input[^>]*inputMode="numeric"[^>]*value="180"/i,
    );
  });

  it("hints 'dalla ricetta v3' only for the values that come from the version", () => {
    const html = render();
    // target and prep come from the version, the minimum is a rule
    expect(html.match(/dalla ricetta v3/g)).toHaveLength(2);
    const allRules = render({
      item: { ...RECIPE, sources: { min: "rule", target: "rule", prep: "rule" } },
    });
    expect(allRules).not.toContain("dalla ricetta");
    const none = render({
      item: {
        ...RECIPE,
        minPortions: null,
        targetPortions: null,
        prepTimeMin: null,
        sources: { min: null, target: null, prep: null },
      },
    });
    expect(none).not.toContain("dalla ricetta");
    expect(none).toMatch(/Porzioni minime[\s\S]*?<input[^>]*value=""/);
  });

  it("has one secondary Salva and an error above it", () => {
    const html = render({ error: "Il tempo di preparazione va da 0 a 1.440 minuti." });
    expect(html.match(/>Salva</g)).toHaveLength(1);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf(">Salva<"));
  });

  it("has no euro sign", () => {
    expect(render()).not.toContain("€");
  });
});

describe("RecipeRuleCard, chef", () => {
  const html = render({ canEdit: false });
  it("shows the values as text with their hints and has no control", () => {
    expect(html).toMatch(/<dt[^>]*>Porzioni minime<\/dt>\s*<dd[^>]*>5<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Porzioni obiettivo<\/dt>\s*<dd[^>]*>30/);
    expect(html).toMatch(/<dt[^>]*>Tempo di preparazione \(min\)<\/dt>\s*<dd[^>]*>180/);
    expect(html).toContain("Restano 4 porzioni");
    expect(html).not.toContain("<input");
    expect(html).not.toContain(">Salva<");
  });
});
