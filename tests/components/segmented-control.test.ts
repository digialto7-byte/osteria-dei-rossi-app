// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "@/components/segmented-control";

afterEach(cleanup);

// The five courses of the comanda, as the page gives them (docs/ux/costi-design-system.md §10.3: one segmented control for every tablist).
const SEGMENTS = [
  { key: "antipasti", label: "Antipasti" },
  { key: "primi", label: "Primi · 2" },
  { key: "secondi", label: "Secondi · 1" },
  { key: "dolci", label: "Dolci" },
  { key: "bevande", label: "Bevande" },
] as const;

const show = (props: Partial<Parameters<typeof SegmentedControl<string>>[0]> = {}) =>
  render(
    createElement(SegmentedControl<string>, {
      label: "Portate",
      segments: SEGMENTS.map((s) => ({ ...s })),
      selected: "primi",
      onSelect: () => undefined,
      ...props,
    }),
  );

describe("SegmentedControl", () => {
  it("is a labelled tablist of tabs in the given order, the selected one marked", () => {
    show();
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

  it("the selected tab is ink-filled and no tab is green", () => {
    show();
    const tabs = screen.getAllByRole("tab");
    const on = tabs.find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(on.classList.contains("bg-ink")).toBe(true);
    expect(on.classList.contains("text-paper")).toBe(true);
    for (const tab of tabs) expect(tab.classList.contains("bg-accent")).toBe(false);
    for (const tab of tabs.filter((tab) => tab !== on)) {
      expect(tab.classList.contains("bg-ink")).toBe(false);
      expect(tab.classList.contains("bg-surface")).toBe(true);
    }
  });

  it("every tab is a 44 px target; comfort makes it the 52 px one", () => {
    show();
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.classList.contains("min-h-tap")).toBe(true);
      expect(tab.classList.contains("min-h-tap-comfort")).toBe(false);
    }
    cleanup();
    show({ comfort: true });
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.classList.contains("min-h-tap-comfort")).toBe(true);
      expect(tab.classList.contains("min-h-tap")).toBe(false);
    }
  });

  it("tapping a tab selects its key", () => {
    const onSelect = vi.fn();
    show({ onSelect });
    fireEvent.click(screen.getByRole("tab", { name: "Dolci" }));
    expect(onSelect).toHaveBeenCalledWith("dolci");
  });

  it("a tab carries the id and the panel it controls when the caller names them", () => {
    show({
      segments: SEGMENTS.map((s) => ({ ...s, id: `tab-${s.key}`, controls: `panel-${s.key}` })),
      selected: "secondi",
    });
    const tab = screen.getByRole("tab", { name: "Secondi · 1" });
    expect(tab.getAttribute("id")).toBe("tab-secondi");
    expect(tab.getAttribute("aria-controls")).toBe("panel-secondi");
  });

  it("puts no id or aria-controls on a tab the caller did not name", () => {
    show();
    const tab = screen.getByRole("tab", { name: "Dolci" });
    expect(tab.hasAttribute("id")).toBe(false);
    expect(tab.hasAttribute("aria-controls")).toBe(false);
  });

  it("keeps the caller's classes on the tablist", () => {
    show({ className: "sticky top-0" });
    expect(screen.getByRole("tablist").classList.contains("sticky")).toBe(true);
  });
});
