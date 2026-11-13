import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeaderBand } from "@/components/header-band";

describe("HeaderBand", () => {
  it("is one banner with the green band classes and the brand slot", () => {
    const html = renderToStaticMarkup(
      createElement(HeaderBand, { brand: createElement("span", null, "MARCHIO") }),
    );
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html).toMatch(/<header class="band border-b-2 border-gold"/);
    expect(html).toContain("MARCHIO");
  });

  it("renders an account slot only when given one", () => {
    const brand = createElement("span", null, "MARCHIO");
    expect(renderToStaticMarkup(createElement(HeaderBand, { brand }))).not.toContain("CONTO");
    expect(
      renderToStaticMarkup(
        createElement(HeaderBand, { brand, account: createElement("span", null, "CONTO") }),
      ),
    ).toContain("CONTO");
  });
});
