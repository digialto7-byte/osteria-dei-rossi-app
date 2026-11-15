import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsoleBand } from "@/components/console/console-band";

// SP3 step 21 (plan section 3.8.3): the console band is the constant "Costì · Console". It never takes a venue or tenant name.
const text = (html: string) => html.replace(/<[^>]*>/g, "");

describe("ConsoleBand", () => {
  it("renders «Costì · Console» and nothing else as text", () => {
    expect(text(renderToStaticMarkup(createElement(ConsoleBand)))).toBe("Costì · Console");
  });

  it("is a header band with the product's tokens: no venue colour override", () => {
    const html = renderToStaticMarkup(createElement(ConsoleBand));
    expect(html).toMatch(/^<header[^>]*class="band /);
    expect(html).not.toContain("--color-band");
    expect(html).not.toContain("<img");
  });

  it("ignores any venue or tenant name passed to it", () => {
    const props = {
      name: "Osteria Demo A",
      venue: { name: "Osteria Demo B" },
      tenantName: "Osteria Demo C",
    };
    const html = renderToStaticMarkup(createElement(ConsoleBand, props as object));
    expect(html).toBe(renderToStaticMarkup(createElement(ConsoleBand)));
    expect(html).not.toContain("Osteria");
    expect(html).not.toContain("Demo");
  });
});
