import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuleForm } from "@/app/(owner)/produzione/personale/rule-form";
import { CELLA, DISPENSA, KEY, PANE_ID } from "./batch-fixtures";

type Props = Parameters<typeof RuleForm>[0];
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(RuleForm, {
      recipes: [{ key: KEY, name: "Ragù (demo)" }],
      ingredients: [{ id: PANE_ID, name: "Pane (demo)", baseUnit: "kg" }],
      locations: [
        { id: CELLA, name: "Cella (demo)" },
        { id: DISPENSA, name: "Dispensa (demo)" },
      ],
      busy: false,
      error: null,
      invalidField: null,
      onSubmit: async () => true,
      ...over,
    }),
  );
const optionsOf = (html: string, name: string) => {
  const select = new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(
    html,
  )![1]!;
  return [...select.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [
    m[1],
    m[2],
  ]);
};

describe("RuleForm, a recipe rule", () => {
  const html = render();

  it("has the type select with the two kinds", () => {
    expect(html).toMatch(/<span[^>]*>Tipo<\/span>/);
    expect(optionsOf(html, "kind")).toEqual([
      ["recipe", "Preparazione"],
      ["ingredient", "Ingrediente"],
    ]);
  });

  it("lists the recipes it was given as the target", () => {
    expect(optionsOf(html, "target").filter(([value]) => value)).toEqual([[KEY, "Ragù (demo)"]]);
  });

  it("has a decimal quantity and no unit or location select", () => {
    expect(html).toMatch(/<input[^>]*inputMode="decimal"/);
    expect(html).not.toContain('name="unit"');
    expect(html).not.toContain('name="location"');
  });

  it("has one submit button, 'Salva regola', styled secondary", () => {
    expect(html.match(/<button[^>]*type="submit"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*border-ink[^>]*>Salva regola<\/button>/);
    expect(html).not.toMatch(/<button[^>]*bg-accent[^>]*>/);
  });
});

describe("RuleForm, an ingredient rule", () => {
  const html = render({ initialKind: "ingredient" });

  it("lists the ingredients as the target", () => {
    expect(optionsOf(html, "target").filter(([value]) => value)).toEqual([
      [PANE_ID, "Pane (demo)"],
    ]);
  });

  it("shows the unit select and the location; before an ingredient is chosen every unit is listed", () => {
    expect(html).toMatch(/<span[^>]*>Unità<\/span>/);
    expect(optionsOf(html, "unit").map(([value]) => value)).toEqual(["kg", "g", "l", "ml", "pz"]);
    expect(html).toMatch(/<span[^>]*>Ubicazione<\/span>/);
  });

  it("lists only the units that fit the chosen ingredient's base unit", () => {
    const picked = render({ initialKind: "ingredient", initialTarget: PANE_ID });
    expect(optionsOf(picked, "unit").map(([value]) => value)).toEqual(["kg", "g"]);
    const liquid = render({
      initialKind: "ingredient",
      initialTarget: PANE_ID,
      ingredients: [{ id: PANE_ID, name: "Latte (demo)", baseUnit: "l" }],
    });
    expect(optionsOf(liquid, "unit").map(([value]) => value)).toEqual(["l", "ml"]);
  });

  it("with two or more locations the location is required: no 'Predefinita', a disabled 'Scegli…' placeholder", () => {
    expect(optionsOf(html, "location")).toEqual([
      ["", "Scegli…"],
      [CELLA, "Cella (demo)"],
      [DISPENSA, "Dispensa (demo)"],
    ]);
    expect(html).not.toContain("Predefinita");
    const control = /<select[^>]*name="location"[^>]*>/.exec(html)![0];
    expect(control).toContain("required");
    expect(/<option[^>]*value=""[^>]*>/.exec(html.split('name="location"')[1]!)![0]).toContain(
      "disabled",
    );
  });

  it("leaves the location out with a single location", () => {
    expect(
      render({ initialKind: "ingredient", locations: [{ id: CELLA, name: "Cella (demo)" }] }),
    ).not.toContain('name="location"');
  });
});

describe("RuleForm, a refused field", () => {
  it.each([
    ["target", "target"],
    ["count", "count"],
    ["unit", "unit"],
    ["location", "location"],
  ] as const)("marks %s aria-invalid and shows the message", (field, name) => {
    const html = render({
      initialKind: "ingredient",
      invalidField: field,
      error: "Quantità non valida.",
    });
    const control = new RegExp(`<(?:input|select)[^>]*name="${name}"[^>]*>`).exec(html)![0];
    expect(control).toContain('aria-invalid="true"');
    expect(html).toMatch(/<p role="alert"[^>]*>Quantità non valida\.<\/p>/);
  });

  it("marks no field invalid without a refused field", () => {
    expect(render()).not.toContain("aria-invalid");
  });
});
