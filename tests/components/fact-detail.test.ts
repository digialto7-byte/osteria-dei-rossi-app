// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactDetail, FactList } from "@/components/fact-list";

// FactDetail is a FactRow that is left out when the reading did not find the value (what `Detail` did for the hairline grid).
const render = (value: string | null) =>
  new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(
        FactList,
        null,
        createElement(FactDetail, { label: "Numero", value, testId: "number" }),
      ),
    ),
    "text/html",
  ).body;

describe("FactDetail", () => {
  it("renders the label and the value with the test id on the value", () => {
    const body = render("FT 12");
    expect(body.querySelector("dt")?.textContent).toBe("Numero");
    expect(body.querySelector('dd[data-testid="number"]')?.textContent).toBe("FT 12");
  });

  it.each([null, ""])("renders no row for %j", (value) => {
    const body = render(value);
    expect(body.querySelector("dt")).toBeNull();
    expect(body.querySelector("dd")).toBeNull();
  });
});
