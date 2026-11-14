// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoNotice } from "@/components/ui";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html").body;

// docs/ux/costi-design-system.md §10.3: the notice in the info tone, next to the warning and danger notices. Said in words, never by colour alone.
describe("InfoNotice", () => {
  it("is a status region in the info tone with its words", () => {
    const root = parse(
      renderToStaticMarkup(createElement(InfoNotice, null, "Manca il codice")),
    ).firstElementChild!;
    expect(root.getAttribute("role")).toBe("status");
    for (const name of ["border-info", "bg-info-bg", "text-info", "border-l-4"]) {
      expect(root.classList.contains(name), name).toBe(true);
    }
    expect(root.textContent).toBe("Manca il codice");
  });

  it("keeps the caller's classes and takes any content", () => {
    const root = parse(
      renderToStaticMarkup(
        createElement(
          InfoNotice,
          { className: "flex flex-col gap-1" },
          createElement("p", null, "a"),
          createElement("p", null, "b"),
        ),
      ),
    ).firstElementChild!;
    expect(root.classList.contains("flex")).toBe(true);
    expect(root.querySelectorAll("p")).toHaveLength(2);
  });

  it("replaces the trace pages' own copy: infoNoteClass is nowhere in src/", () => {
    const SRC = join(process.cwd(), "src");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.(ts|tsx)$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const users = files(SRC).filter((f) => readFileSync(f, "utf8").includes("infoNoteClass"));
    expect(users).toEqual([]);
  });
});
