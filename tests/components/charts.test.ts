import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarTable, type BarRow } from "@/components/charts/bar-table";
import { Meter } from "@/components/charts/meter";

const rows: BarRow[] = [
  {
    key: "a",
    label: "Tagliatelle (fixture)",
    valueText: "GP 60,00 %",
    value: 60,
    target: 70,
    below: true,
    data: { "data-recipe-key": "ec000000-0000-4000-8000-000000000001" },
  },
  { key: "b", label: "Gnocchi (fixture)", valueText: "GP 80,00 %", value: 80, target: null },
];

const table = (r: BarRow[] = rows, max = 100) =>
  renderToStaticMarkup(
    createElement(BarTable, { caption: "Margine lordo per piatto", rows: r, max }),
  );

describe("BarTable", () => {
  it("is a real table with a caption that states the question", () => {
    const html = table();
    expect(html).toMatch(/<table[\s>]/);
    expect(html).toMatch(/<caption[^>]*>Margine lordo per piatto<\/caption>/);
  });

  it("has one row header per row and the value as text in the row", () => {
    const html = table();
    expect(html.match(/<th[^>]*scope="row"/g)).toHaveLength(2);
    expect(html).toContain("Tagliatelle (fixture)");
    expect(html).toContain("GP 60,00 %");
    expect(html).toContain("GP 80,00 %");
  });

  it("carries the row's data attributes", () => {
    expect(table()).toContain('data-recipe-key="ec000000-0000-4000-8000-000000000001"');
  });

  it("every svg is aria-hidden and not focusable", () => {
    const html = table();
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('focusable="false"');
      expect(svg).toContain('viewBox="0 0 100 8"');
    }
  });

  it("draws the value rect at the percentage, in accent, and danger when below target", () => {
    const html = table();
    const values = html.match(/<rect[^>]*data-chart-value[^>]*>/g) ?? [];
    expect(values).toHaveLength(2);
    expect(values[0]).toContain('width="60"');
    expect(values[0]).toContain("fill-danger");
    expect(values[1]).toContain('width="80"');
    expect(values[1]).toContain("fill-accent");
  });

  it("scales bars to the largest value given as max", () => {
    const html = table([{ key: "x", label: "Caduto", valueText: "6,00 €", value: 6 }], 12);
    expect(html).toMatch(/<rect[^>]*data-chart-value[^>]*width="50"/);
  });

  it("draws a target tick only when there is a target", () => {
    const html = table();
    const ticks = html.match(/<line[^>]*>/g) ?? [];
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toContain('x1="70"');
    expect(ticks[0]).toContain("stroke-ink");
    expect(ticks[0]).toContain('vector-effect="non-scaling-stroke"');
  });

  it("draws a track under every bar", () => {
    expect(table().match(/data-chart-track/g)).toHaveLength(2);
  });

  it("renders a null value as an empty bar", () => {
    const html = table([{ key: "n", label: "Senza dato", valueText: "n.d.", value: null }]);
    expect(html).toMatch(/data-chart-value[^>]*width="0"/);
  });

  it("renders the extra node of a row (a badge) beside the value", () => {
    const html = table([
      {
        key: "e",
        label: "P",
        valueText: "GP 60,00 %",
        value: 60,
        extra: createElement("b", null, "Sotto obiettivo"),
      },
    ]);
    expect(html).toContain("<b>Sotto obiettivo</b>");
  });

  it("renders a plate name containing markup as text", () => {
    const html = table([
      { key: "s", label: "<script>alert(1)</script>", valueText: "1", value: 1 },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders nothing for no rows", () => {
    expect(table([])).toBe("");
  });
});

describe("Meter", () => {
  const html = renderToStaticMarkup(
    createElement(Meter, { value: 28.28, valueText: "28,28 %", label: "Food cost medio del menu" }),
  );

  it("has an aria-hidden svg and the visible figure", () => {
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toMatch(/28,28\s+%/);
  });

  it("draws the bar at the value on a 0-100 scale", () => {
    expect(html).toMatch(/data-chart-value[^>]*width="28.3"/);
  });

  it("an empty value draws an empty bar and no figure is invented", () => {
    const empty = renderToStaticMarkup(
      createElement(Meter, { value: null, valueText: "n.d.", label: "x" }),
    );
    expect(empty).toMatch(/data-chart-value[^>]*width="0"/);
    expect(empty).toContain("n.d.");
  });
});

describe("what the charts never contain (ui-foundation §7)", () => {
  const markup = [
    table(),
    renderToStaticMarkup(createElement(Meter, { value: 50, valueText: "50 %", label: "x" })),
  ].join("");

  it("has no style attribute, image, foreignObject, data: URI, icon font or palette colour", () => {
    expect(markup).not.toMatch(/\sstyle=/);
    expect(markup).not.toContain("<image");
    expect(markup).not.toContain("<foreignObject");
    expect(markup).not.toContain("data:");
    expect(markup).not.toContain("<i class");
    expect(markup).not.toMatch(/(red|green|gray|blue|amber|slate)-\d{3}/);
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
