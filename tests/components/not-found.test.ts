import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFound from "@/app/not-found";

// QW1 moves the header band out of the root layout, so the default 404 would have none. The page brings its own band and a way back.
describe("the 404 page", () => {
  const html = renderToStaticMarkup(createElement(NotFound));

  it("has one band with the link to Home, and exactly one main", () => {
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html).toMatch(/<header[^>]*class="band /);
    expect(html).toMatch(/<a[^>]*aria-label="Osteria Dei Rossi, Home"[^>]*href="\/"/);
    expect(html.match(/<main/g)).toHaveLength(1);
  });

  it("says the page is not found and offers a link back", () => {
    expect(html).toContain("Pagina non trovata.");
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Torna alla Home<\/a>/);
  });
});
