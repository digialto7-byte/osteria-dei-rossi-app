// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { BottomTabsView } from "@/components/nav/bottom-tabs";
import { phoneTabs } from "@/lib/nav/nav-model";

afterEach(cleanup);

// docs/ux/costi-design-system.md §3 (costi/label-sm) and strategy F21: tab labels are 15 px, not 14 px.
describe("the phone's bottom tab bar", () => {
  const tabs = phoneTabs("owner");

  it("has five tabs for the owner", () => {
    render(createElement(BottomTabsView, { tabs, current: tabs[0]!.key }));
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });

  it("sets every tab label at 15 px (text-[0.9375rem]) and none at text-sm", () => {
    render(createElement(BottomTabsView, { tabs, current: tabs[0]!.key }));
    for (const tab of screen.getAllByRole("link")) {
      expect(tab.classList.contains("text-[0.9375rem]"), tab.textContent ?? "").toBe(true);
      expect(tab.classList.contains("text-sm"), tab.textContent ?? "").toBe(false);
    }
  });

  it("keeps each tab at least 44 px tall, and the current one ink-filled", () => {
    render(createElement(BottomTabsView, { tabs, current: tabs[0]!.key }));
    const links = screen.getAllByRole("link");
    for (const tab of links) expect(tab.classList.contains("min-h-tap")).toBe(true);
    expect(links[0]!.classList.contains("bg-ink")).toBe(true);
    expect(links[0]!.getAttribute("aria-current")).toBe("page");
  });
});
