import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuleFacts } from "@/app/(owner)/riordino/rule-facts";

const html = renderToStaticMarkup(
  createElement(RuleFacts, {
    rows: [
      { label: "Minimo", value: "5 kg" },
      { label: "Obiettivo", value: "12 kg" },
    ],
  }),
);

describe("RuleFacts", () => {
  it("is a FactList: one dl, the label in a dt and the value in a .num dd", () => {
    expect(html.match(/<dl[\s>]/g)).toHaveLength(1);
    expect(html).toContain("grid-cols-[auto_minmax(min-content,1fr)]");
    expect(html).toMatch(/<dt[^>]*>Minimo<\/dt>\s*<dd[^>]*class="num[^"]*"[^>]*>5 kg<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Obiettivo<\/dt>\s*<dd[^>]*class="num[^"]*"[^>]*>12 kg<\/dd>/);
  });
});
