// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactList, FactRow } from "@/components/fact-list";

// FactRow's props type requires `children`; createElement passes them as its third argument.
type RowProps = ComponentProps<typeof FactRow>;
type ListProps = ComponentProps<typeof FactList>;
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html").body;

// docs/ux/costi-design-system.md §10.3: a label and its figure, as a definition list of two columns.
describe("FactList and FactRow", () => {
  const body = parse(
    renderToStaticMarkup(
      createElement(
        FactList,
        null,
        createElement(FactRow, { label: "Lotto" } as RowProps, "L-12"),
        createElement(FactRow, { label: "Consegna", end: true } as RowProps, "13 nov"),
      ),
    ),
  );

  it("is one dl grid with the label column sized to its content", () => {
    const list = body.firstElementChild!;
    expect(list.tagName).toBe("DL");
    expect(list.className).toContain("grid");
    expect(list.className).toContain("grid-cols-[auto_minmax(min-content,1fr)]");
  });

  it("gives each row a muted dt with the label and a numeric dd with the value", () => {
    const terms = [...body.querySelectorAll("dt")];
    const values = [...body.querySelectorAll("dd")];
    expect(terms.map((el) => el.textContent)).toEqual(["Lotto", "Consegna"]);
    expect(values.map((el) => el.textContent)).toEqual(["L-12", "13 nov"]);
    for (const dt of terms) expect(dt.classList.contains("text-ink-muted")).toBe(true);
    for (const dd of values) expect(dd.classList.contains("num")).toBe(true);
  });

  it("wraps long values and right-aligns a value only when asked", () => {
    const [first, second] = [...body.querySelectorAll("dd")];
    expect(first!.className).toContain("[overflow-wrap:anywhere]");
    expect(first!.classList.contains("text-right")).toBe(false);
    expect(second!.classList.contains("text-right")).toBe(true);
  });

  it("replaces the trace pages' own copy: FACT_LIST_CLASS and function Fact are nowhere in src/", () => {
    const SRC = join(process.cwd(), "src");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.(ts|tsx)$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const users = files(SRC).filter((f) =>
      /FACT_LIST_CLASS|function Fact\(/.test(readFileSync(f, "utf8")),
    );
    expect(users).toEqual([]);
  });

  it("carries a test id on the list and on a row's value when given one", () => {
    const html = renderToStaticMarkup(
      createElement(
        FactList,
        { testId: "facts" } as ListProps,
        createElement(FactRow, { label: "Numero", testId: "number" } as RowProps, "FT 12"),
      ),
    );
    const doc = parse(html);
    expect(doc.querySelector("dl")?.getAttribute("data-testid")).toBe("facts");
    expect(doc.querySelector("dd")?.getAttribute("data-testid")).toBe("number");
    expect(doc.querySelector("dt")?.hasAttribute("data-testid")).toBe(false);
  });
});
