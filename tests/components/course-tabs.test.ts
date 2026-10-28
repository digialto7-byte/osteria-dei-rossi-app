// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseTabs } from "@/app/(owner)/tavoli/[sessionId]/course-tabs";

afterEach(cleanup);
const COUNTS = { antipasti: 0, primi: 2, secondi: 1, dolci: 0, bevande: 0 };

describe("CourseTabs", () => {
  it("is a tablist of five tabs in service order, the selected one marked", () => {
    render(
      createElement(CourseTabs, { selected: "primi", counts: COUNTS, onSelect: () => undefined }),
    );
    expect(screen.getByRole("tablist", { name: "Portate" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Antipasti",
      "Primi · 2",
      "Secondi · 1",
      "Dolci",
      "Bevande",
    ]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
      "false",
      "false",
    ]);
  });

  it("every tab is a 44 px target", () => {
    render(
      createElement(CourseTabs, { selected: "primi", counts: COUNTS, onSelect: () => undefined }),
    );
    for (const tab of screen.getAllByRole("tab")) expect(tab.className).toContain("min-h-tap");
  });

  it("tapping a tab selects its course", () => {
    const onSelect = vi.fn();
    render(createElement(CourseTabs, { selected: "primi", counts: COUNTS, onSelect }));
    fireEvent.click(screen.getByRole("tab", { name: "Dolci" }));
    expect(onSelect).toHaveBeenCalledWith("dolci");
  });

  it("a tab points at the panel it controls", () => {
    render(
      createElement(CourseTabs, { selected: "secondi", counts: COUNTS, onSelect: () => undefined }),
    );
    expect(screen.getByRole("tab", { name: "Secondi · 1" }).getAttribute("aria-controls")).toBe(
      "panel-secondi",
    );
  });
});
