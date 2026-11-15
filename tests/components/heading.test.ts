// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Heading } from "@/components/ui";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html").body;

// A page title is often a name from the data (a venue, a recipe, a supplier). One long word with no break opportunity, such as a venue
// called "Trattoriadelpontevecchiodisanfrediano", must wrap inside a 360 px phone instead of pushing the page sideways (UX: no
// horizontal scroll at 360 px). jsdom does not lay out, so the test pins the rule that does it: overflow-wrap:anywhere on the h1.
describe("Heading", () => {
  const long = "Trattoriadelpontevecchiodisanfrediano".repeat(2);
  const h1 = parse(renderToStaticMarkup(createElement(Heading, null, long))).firstElementChild!;

  it("is one h1 with the text as given", () => {
    expect(h1.tagName).toBe("H1");
    expect(h1.textContent).toBe(long);
  });

  it("breaks a long single word instead of overflowing a 360 px screen", () => {
    expect(h1.className).toContain("[overflow-wrap:anywhere]");
  });
});
