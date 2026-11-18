// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactDetail, FactList, FactRow } from "@/components/fact-list";
import { CostFact } from "@/app/(owner)/costi/ricette/[key]/cost-fact";

const html = (...children: React.ReactNode[]) =>
  renderToStaticMarkup(createElement(FactList, null, ...children));

const row = (props: { figure?: boolean }, text: string) =>
  createElement(
    FactRow,
    { label: "A", testId: "x", ...props } as ComponentProps<typeof FactRow>,
    text,
  );

describe("FactRow wrapping", () => {
  it("by default a value may break anywhere (long names, codes)", () => {
    const out = html(row({}, "v"));
    expect(out).toContain("[overflow-wrap:anywhere]");
  });

  it("a figure never breaks inside: no overflow-wrap:anywhere, still a num", () => {
    const out = html(row({ figure: true }, "13.500,00 €"));
    expect(out).not.toContain("overflow-wrap");
    expect(out).toMatch(/<dd data-testid="x" class="num[^"]*"/);
  });

  it("FactDetail passes figure on", () => {
    const out = html(
      createElement(FactDetail, { label: "A", value: "9,00 €", testId: "x", figure: true }),
    );
    expect(out).not.toContain("overflow-wrap");
  });
});

describe("CostFact", () => {
  const render = (value: number | null, strong?: boolean) =>
    renderToStaticMarkup(
      createElement(
        FactList,
        null,
        createElement(CostFact, { label: "Costo", value, testId: "cost-x", strong }),
      ),
    );

  it.each([null])("leaves the row and its testid out for %j", (value) => {
    const out = render(value);
    expect(out).not.toContain("cost-x");
    expect(out).not.toContain("<dt");
  });

  it("a strong figure is inside <strong> under its testid, unbreakable", () => {
    const out = render(9, true);
    expect(out).toMatch(/<dd data-testid="cost-x"[^>]*><strong>9,00[^<]*€<\/strong><\/dd>/);
    expect(out).not.toContain("overflow-wrap");
  });

  it("a plain figure is not wrapped in <strong>", () => {
    const out = render(9);
    expect(out).toMatch(/<dd data-testid="cost-x"[^>]*>9,00[^<]*€<\/dd>/);
  });
});
