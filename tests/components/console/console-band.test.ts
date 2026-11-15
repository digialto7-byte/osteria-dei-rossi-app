import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsoleBand } from "@/components/console/console-band";

// SP3 step 21 (plan section 3.8.3): the console band is the constant "Costì · Console". It never takes a venue or tenant name.
const text = (html: string) => html.replace(/<[^>]*>/g, "");

describe("ConsoleBand", () => {
  it("renders «Costì · Console» and nothing else as text", () => {
    expect(text(renderToStaticMarkup(createElement(ConsoleBand, { account: null })))).toBe(
      "Costì · Console",
    );
  });

  it("is a header band with the product's tokens: no venue colour override", () => {
    const html = renderToStaticMarkup(createElement(ConsoleBand, { account: null }));
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
    const html = renderToStaticMarkup(
      createElement(ConsoleBand, { ...props, account: null } as never),
    );
    expect(html).toBe(renderToStaticMarkup(createElement(ConsoleBand, { account: null })));
    expect(html).not.toContain("Osteria");
    expect(html).not.toContain("Demo");
  });

  it("shows a passed account node inside the band, after the label, on the right", () => {
    const html = renderToStaticMarkup(
      createElement(ConsoleBand, {
        account: createElement("button", { type: "button" }, "Esci"),
      }),
    );
    const band = html.slice(0, html.indexOf("</header>"));
    expect(band).toContain("<button");
    expect(html.indexOf("Console")).toBeLessThan(html.indexOf("<button"));
    expect(html).toMatch(/<div class="[^"]*ml-auto[^"]*"><button[^>]*>Esci<\/button><\/div>/);
    expect(text(html)).toBe("Costì · ConsoleEsci");
  });

  it("adds no element at all when the account is null: no empty wrapper", () => {
    const html = renderToStaticMarkup(createElement(ConsoleBand, { account: null }));
    expect(html).not.toContain("ml-auto");
    expect(html.match(/<(?!\/)[a-z]+/g)).toEqual(["<header", "<div", "<span"]);
  });

  it("null is the only empty value: omitting account, undefined and booleans do not type-check", () => {
    // Checked by tsc (npx tsc --noEmit): a @ts-expect-error that stops matching is itself an error. Never called.
    const typeChecks = () => {
      // @ts-expect-error account is required
      createElement(ConsoleBand, {});
      // @ts-expect-error undefined is not an empty value
      createElement(ConsoleBand, { account: undefined });
      // @ts-expect-error a boolean is not an empty value
      createElement(ConsoleBand, { account: false });
      createElement(ConsoleBand, { account: null });
      createElement(ConsoleBand, { account: "Esci" });
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});
