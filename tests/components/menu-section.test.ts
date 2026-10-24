// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MenuSection } from "@/app/(owner)/tavoli/[sessionId]/menu-section";
import { DESSERT_ITEM, MENU, PASTA_ITEM, SOUP_ITEM, STEW_ITEM } from "../helpers/order-components";

afterEach(cleanup);
const show = (course: "primi" | "secondi" | "dolci" | "antipasti") =>
  render(createElement(MenuSection, { course, menu: MENU, onAdd: () => undefined }));

describe("MenuSection", () => {
  it("is the tab's panel, with the course's dishes grouped by category", () => {
    show("primi");
    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe("panel-primi");
    const group = within(panel).getByRole("region", { name: "Primi" });
    const ids = within(group)
      .getAllByRole("button")
      .map((b) => b.getAttribute("data-menu-item-id"));
    expect(ids).toEqual([SOUP_ITEM.id, PASTA_ITEM.id]);
  });

  it("puts the other courses' dishes under 'Altri piatti'", () => {
    show("primi");
    const others = screen.getByText("Altri piatti").closest("details")!;
    const ids = within(others)
      .getAllByRole("button", { hidden: true })
      .map((b) => b.getAttribute("data-menu-item-id"));
    expect(ids.sort()).toEqual([STEW_ITEM.id, DESSERT_ITEM.id].sort());
    expect(others.hasAttribute("open")).toBe(false);
  });

  it("a course with no dish still offers the rest", () => {
    show("antipasti");
    expect(screen.queryByRole("region", { name: "Antipasti" })).toBeNull();
    expect(screen.getByText("Altri piatti")).toBeTruthy();
  });
});
