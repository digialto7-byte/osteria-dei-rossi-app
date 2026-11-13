// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// P2-1 T-12: the nav entry into a QR page must be a document load. next/link is a client navigation, so it is faked here with a marker
// to tell it from a plain anchor (jsdom renders both as <a>).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, "data-next-link": "true", ...rest }, children),
}));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));

import { BottomTabsView } from "@/components/nav/bottom-tabs";
import { SectionNavView } from "@/components/nav/section-nav";
import { SidebarNavView } from "@/components/nav/sidebar-nav";
import { navFor, tabsForGroups } from "@/lib/nav/nav-model";

afterEach(cleanup);

const registro = navFor("owner").find((g) => g.key === "registro")!;
const link = (name: string) => screen.getByRole("link", { name });

describe("the nav entry to /doppia-verifica is a full document load", () => {
  it("in the phone's section pills", () => {
    render(createElement(SectionNavView, { group: registro, currentHref: "/sicurezza" }));
    expect(link("Verifica in due passaggi").getAttribute("href")).toBe("/doppia-verifica");
    expect(link("Verifica in due passaggi").hasAttribute("data-next-link")).toBe(false);
    expect(link("Costi").hasAttribute("data-next-link")).toBe(true);
  });

  it("in the laptop's sidebar", () => {
    render(
      createElement(SidebarNavView, {
        groups: navFor("owner"),
        currentHref: "/sicurezza",
        userName: "Titolare",
        roleLabel: "Titolare",
      }),
    );
    expect(link("Verifica in due passaggi").hasAttribute("data-next-link")).toBe(false);
    expect(link("Costi").hasAttribute("data-next-link")).toBe(true);
  });

  it("in the bottom tabs, should a tab ever lead there", () => {
    const tabs = [
      { key: "registro", labelKey: "nav.mfa", href: "/doppia-verifica", groups: ["registro"] },
      { key: "home", labelKey: "nav.costs", href: "/costi", groups: ["home"] },
    ] as ReturnType<typeof tabsForGroups>;
    render(createElement(BottomTabsView, { tabs, current: null }));
    expect(link("Verifica in due passaggi").hasAttribute("data-next-link")).toBe(false);
    expect(link("Costi").hasAttribute("data-next-link")).toBe(true);
  });
});
