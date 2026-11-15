// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KitchenCard } from "@/components/home/kitchen-card";
import type { KitchenCardState } from "@/lib/kitchen/kitchen-view";

afterEach(cleanup);

const STATES: [string, KitchenCardState, string, string | null][] = [
  ["loading", { status: "loading" }, "Comande aperte", null],
  ["error", { status: "error" }, "Comande aperte", "Il numero delle comande non è disponibile."],
  [
    "empty",
    { status: "ok", open: 0, remaining: 0, more: false },
    "Nessuna comanda in cucina.",
    null,
  ],
  ["ok", { status: "ok", open: 2, remaining: 7, more: false }, "Comande aperte · 2", "Da fare: 7"],
  [
    "capped",
    { status: "ok", open: 200, remaining: 7, more: true },
    "Comande aperte · 200 o più",
    "Da fare: 7",
  ],
];

const show = (state: KitchenCardState) => {
  const view = render(createElement(KitchenCard, { state }));
  return view.container;
};

describe("KitchenCard", () => {
  it.each(STATES)("%s: one link to /cucina with the words", (_name, state, title, detail) => {
    const container = show(state);
    const links = container.querySelectorAll('a[href="/cucina"][data-kitchen-card]');
    expect(links).toHaveLength(1);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    const text = links[0]!.textContent ?? "";
    expect(text).toContain(title);
    if (detail) expect(text).toContain(detail);
    expect(text).toContain("Apri la cucina");
    expect(text).not.toContain("€");
  });

  it("is a card-like link, not a second primary", () => {
    const link = show({ status: "ok", open: 1, remaining: 1, more: false }).querySelector("a")!;
    expect(link.className).not.toContain("bg-accent");
    expect(link.className).toContain("min-h-tap");
    expect(link.className).toContain("border-rule");
  });

  it("says a failure in plain text, not as an alert", () => {
    expect(show({ status: "error" }).querySelector('[role="alert"]')).toBeNull();
  });

  it("hides the arrow from the accessible name", () => {
    const container = show({ status: "loading" });
    const arrow = container.querySelector('a [aria-hidden="true"]');
    expect(arrow?.textContent).toBe("›");
  });
});
