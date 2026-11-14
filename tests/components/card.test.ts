// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html").body;

describe("Card", () => {
  it("is a raised, ruled sheet with no edge by default", () => {
    const root = parse(renderToStaticMarkup(createElement(Card, null, "x"))).firstElementChild!;
    expect(root.className).toContain("rounded-card");
    expect(root.className).toContain("bg-surface");
    expect(root.className).not.toContain("overflow-hidden");
    expect(root.querySelector("[aria-hidden]")).toBeNull();
  });

  // docs/ux/costi-design-system.md §10.3: the Coral edge of the sign-in card, as a prop.
  it("edge puts a decorative Coral rule first, and clips it to the card", () => {
    const root = parse(
      renderToStaticMarkup(createElement(Card, { edge: true }, "x")),
    ).firstElementChild!;
    expect(root.classList.contains("relative")).toBe(true);
    expect(root.classList.contains("overflow-hidden")).toBe(true);
    const edge = root.firstElementChild!;
    expect(edge.matches("span[aria-hidden].h-1.bg-gold")).toBe(true);
    expect(edge.textContent).toBe("");
    expect(root.textContent).toBe("x");
  });

  it("keeps the caller's classes and attributes with the edge", () => {
    const root = parse(
      renderToStaticMarkup(
        createElement(Card, { edge: true, className: "mt-4", role: "group" }, "x"),
      ),
    ).firstElementChild!;
    expect(root.classList.contains("mt-4")).toBe(true);
    expect(root.getAttribute("role")).toBe("group");
  });
});
