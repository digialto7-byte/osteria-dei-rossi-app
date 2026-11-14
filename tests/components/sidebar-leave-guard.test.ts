// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// QW12 (ADR-041 decision 3): at 1024 px and wider the comanda page sits next to the sidebar, and the sidebar's links and "Esci" are
// exits too. They ask the page's leave guard like the header does; a QR page (needsFullLoad) is still a full document load.
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, "data-next-link": "true", ...rest }, children),
}));
const apiJson = vi.fn(() => Promise.resolve({ ok: true, status: 204, data: undefined }));
vi.mock("@/lib/api/client", () => ({ apiJson: (...args: unknown[]) => apiJson(...(args as [])) }));
vi.mock("@/components/forget-user", () => ({ forgetUser: () => undefined }));
vi.mock("@/pwa/use-outbox", () => ({
  useSyncView: () => ({ ready: true, pending: 0, mine: 0, visible: false }),
}));

const { LeaveGuardProvider, useLeaveGuard } = await import("@/components/nav/leave-guard");
const { SidebarNavView } = await import("@/components/nav/sidebar-nav");
const { navFor } = await import("@/lib/nav/nav-model");

const assign = vi.fn();
const replace = vi.fn();
const realLocation = window.location;
beforeEach(() => {
  push.mockClear();
  assign.mockClear();
  replace.mockClear();
  apiJson.mockClear();
  Object.defineProperty(window, "location", { value: { assign, replace }, configurable: true });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { value: realLocation, configurable: true });
});

let held: (() => void) | null = null;
const guard = (go: () => void) => {
  held = go;
  return true;
};
function Page({ withGuard }: { withGuard: boolean }) {
  useLeaveGuard(withGuard ? guard : null);
  return createElement(SidebarNavView, {
    groups: navFor("owner"),
    currentHref: "/tavoli",
    userName: "Titolare",
    roleLabel: "Titolare",
  });
}
const show = (withGuard: boolean) => {
  held = null;
  render(createElement(LeaveGuardProvider, null, createElement(Page, { withGuard })));
};
const tap = (name: string, init: Partial<MouseEventInit> = {}) => {
  const link = screen.getByRole("link", { name });
  const event = createEvent.click(link, { bubbles: true, cancelable: true, ...init });
  fireEvent(link, event);
  return event.defaultPrevented;
};

describe("the laptop sidebar on a page with a leave guard", () => {
  it("a link is stopped, and the guard's go is a client navigation", () => {
    show(true);
    expect(tap("Costi dei piatti")).toBe(true);
    expect(push).not.toHaveBeenCalled();
    held!();
    expect(push).toHaveBeenCalledWith("/costi");
  });

  it("a QR page link is stopped too, and the guard's go is a full document load", () => {
    show(true);
    expect(tap("Verifica in due passaggi")).toBe(true);
    expect(assign).not.toHaveBeenCalled();
    held!();
    expect(assign).toHaveBeenCalledWith("/doppia-verifica");
    expect(push).not.toHaveBeenCalled();
  });

  it("a QR page link stays a plain anchor, not a next/link", () => {
    show(true);
    expect(
      screen.getByRole("link", { name: "Verifica in due passaggi" }).hasAttribute("data-next-link"),
    ).toBe(false);
    expect(
      screen.getByRole("link", { name: "Costi dei piatti" }).hasAttribute("data-next-link"),
    ).toBe(true);
  });

  it("'Esci' asks the guard first and signs nobody out until it lets go", async () => {
    show(true);
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    expect(apiJson).not.toHaveBeenCalled();
    held!();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(apiJson).toHaveBeenCalledTimes(1);
  });

  it("a ctrl-click on either kind of link is never intercepted", () => {
    show(true);
    expect(tap("Costi dei piatti", { ctrlKey: true })).toBe(false);
    expect(tap("Verifica in due passaggi", { ctrlKey: true })).toBe(false);
    expect(held).toBeNull();
  });
});

describe("the laptop sidebar on a page with no guard", () => {
  it("links go as before and 'Esci' signs out at once", async () => {
    show(false);
    expect(tap("Costi dei piatti")).toBe(false);
    expect(tap("Verifica in due passaggi")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
