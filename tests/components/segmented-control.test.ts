// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("SegmentedControl keyboard (manual activation)", () => {
  const fiveTabs = () =>
    screen.getAllByRole("tab") as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
  const stops = () => screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex"));
  const key = (tab: HTMLElement, name: string) => fireEvent.keyDown(tab, { key: name });

  it("roving tabindex: the selected tab is the one tab stop", () => {
    show();
    expect(stops()).toEqual(["-1", "0", "-1", "-1", "-1"]);
  });

  it("the tab stop follows `selected` when it changes from outside", () => {
    const { rerender } = show();
    rerender(
      createElement(SegmentedControl<string>, {
        label: "Portate",
        segments: SEGMENTS.map((s) => ({ ...s })),
        selected: "bevande",
        onSelect: () => undefined,
      }),
    );
    expect(stops()).toEqual(["-1", "-1", "-1", "-1", "0"]);
  });

  it("the tab stop falls back to the first tab when the selected one leaves the list", () => {
    const { rerender } = show();
    rerender(
      createElement(SegmentedControl<string>, {
        label: "Portate",
        segments: SEGMENTS.filter((s) => s.key !== "primi").map((s) => ({ ...s })),
        selected: "primi",
        onSelect: () => undefined,
      }),
    );
    expect(stops()).toEqual(["0", "-1", "-1", "-1"]);
  });

  it("ArrowRight moves focus to the next tab and does not select it", () => {
    const onSelect = vi.fn();
    show({ onSelect });
    const tabs = fiveTabs();
    act(() => tabs[1].focus());
    key(tabs[1], "ArrowRight");
    expect(document.activeElement).toBe(tabs[2]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });

  it("ArrowLeft moves focus to the previous tab", () => {
    show();
    const tabs = fiveTabs();
    act(() => tabs[1].focus());
    key(tabs[1], "ArrowLeft");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("the arrows wrap at both ends", () => {
    show();
    const tabs = fiveTabs();
    act(() => tabs[4].focus());
    key(tabs[4], "ArrowRight");
    expect(document.activeElement).toBe(tabs[0]);
    key(tabs[0], "ArrowLeft");
    expect(document.activeElement).toBe(tabs[4]);
  });

  it("Home and End move focus to the first and last tab", () => {
    const onSelect = vi.fn();
    show({ onSelect });
    const tabs = fiveTabs();
    act(() => tabs[2].focus());
    key(tabs[2], "End");
    expect(document.activeElement).toBe(tabs[4]);
    key(tabs[4], "Home");
    expect(document.activeElement).toBe(tabs[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("the keys we handle are claimed (default prevented); other keys are not", () => {
    show();
    const tabs = fiveTabs();
    act(() => tabs[1].focus());
    expect(fireEvent.keyDown(tabs[1], { key: "ArrowRight" })).toBe(false);
    act(() => tabs[2].focus());
    for (const other of ["Tab", "a", "ArrowDown", "ArrowUp", "Escape", "PageDown"]) {
      expect(fireEvent.keyDown(tabs[2], { key: other })).toBe(true);
    }
    expect(document.activeElement).toBe(tabs[2]);
  });

  it("Alt, Ctrl and Meta with an arrow are left to the browser (no focus move, no preventDefault)", () => {
    show();
    const tabs = fiveTabs();
    act(() => tabs[1].focus());
    for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      for (const name of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
        expect(fireEvent.keyDown(tabs[1], { key: name, ...mod })).toBe(true);
      }
    }
    expect(document.activeElement).toBe(tabs[1]);
  });

  it("other keys select nothing", () => {
    const onSelect = vi.fn();
    show({ onSelect });
    const tabs = fiveTabs();
    act(() => tabs[1].focus());
    for (const other of ["Tab", "a", "ArrowDown", "Escape"]) key(tabs[1], other);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter and Space are left to the native button (it clicks, so onSelect runs once, from the click)", () => {
    // jsdom does not turn Enter/Space into a click, so we assert the two halves: the keys are not claimed, and a tab is a real <button>.
    const onSelect = vi.fn();
    show({ onSelect });
    const tabs = fiveTabs();
    act(() => tabs[2].focus());
    expect(fireEvent.keyDown(tabs[2], { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(tabs[2], { key: " " })).toBe(true);
    expect(fireEvent.keyUp(tabs[2], { key: " " })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    for (const tab of tabs) expect(tab.tagName).toBe("BUTTON");
    fireEvent.click(tabs[2]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("secondi");
  });
});
