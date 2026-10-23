import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecipeLines } from "@/app/(owner)/ricette/[key]/recipe-lines";
import { BATCH, PLATE } from "./recipe-fixtures";

const render = (lines = BATCH.lines) => renderToStaticMarkup(createElement(RecipeLines, { lines }));

describe("RecipeLines", () => {
  it("shows the target name in bold and the quantity and yield in a .num line", () => {
    const html = render();
    expect(html).toMatch(/<[^>]*font-bold[^>]*>Manzo muscolo \(demo\)</);
    expect(html).toMatch(/class="num[^"]*"[^>]*>5 kg · resa 1</);
  });

  it("a yield above 1 carries the warning badge with a word", () => {
    const html = render(PLATE.lines);
    expect(html).toMatch(/bg-warning-bg[^>]*>[\s\S]*Resa &gt; 1/);
    expect(html.match(/Resa &gt; 1/g)).toHaveLength(1);
  });

  it("links a sub-recipe or batch line to that recipe, an ingredient to nothing", () => {
    const html = render(PLATE.lines);
    expect(html).toContain('href="/ricette/cc"');
    expect(html).toContain('href="/ricette/ee"');
    expect(render()).not.toContain("<a ");
  });
});
