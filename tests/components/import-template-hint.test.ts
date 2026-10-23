import { describe, expect, it } from "vitest";
import { templateHint, type ImportKind } from "@/app/(owner)/anagrafiche/importa/templates";

const KINDS: ImportKind[] = ["suppliers", "ingredients", "recipes"];

describe("import template hint", () => {
  it.each(
    KINDS.flatMap((kind) => (["it", "en"] as const).map((locale) => [kind, locale] as const)),
  )("%s (%s): the columns label appears exactly once", (kind, locale) => {
    const label = locale === "it" ? "Colonne:" : "Columns:";
    const hint = templateHint(kind, locale);
    expect(hint.split(label).length - 1).toBe(1);
    expect(hint.startsWith(label)).toBe(true);
  });

  it("the recipes hint lists the template columns", () => {
    expect(templateHint("recipes", "it")).toContain("ricetta; tipo");
    expect(templateHint("recipes", "it")).toContain("resa");
  });
});
