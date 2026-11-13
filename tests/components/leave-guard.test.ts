// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// QW12 (docs/plans/2026-11-13-ux-quick-wins.md): a page registers a guard; an in-app exit asks it first. Without a guard nothing changes,
// and a modified click (a new tab) is never intercepted.
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const { GuardedLink, LeaveGuardProvider, useLeaveGuard, useRequestLeave } =
  await import("@/components/nav/leave-guard");

beforeEach(() => push.mockClear());
afterEach(cleanup);

function Page({ guard, go }: { guard: ((go: () => void) => boolean) | null; go?: () => void }) {
  useLeaveGuard(guard);
  const requestLeave = useRequestLeave();
  return createElement(
    "div",
    null,
    createElement(GuardedLink, { href: "/tavoli" }, "Tavoli"),
    createElement(
      "button",
      { type: "button", onClick: () => requestLeave(go ?? (() => {})) },
      "Esci",
    ),
  );
}

const show = (guard: ((go: () => void) => boolean) | null, go?: () => void) =>
  render(createElement(LeaveGuardProvider, null, createElement(Page, { guard, go })));

/** Clicks the link and says whether the browser's own navigation was stopped. */
function click(init: Partial<MouseEventInit> = {}): boolean {
  const link = screen.getByRole("link", { name: "Tavoli" });
  const event = createEvent.click(link, { bubbles: true, cancelable: true, ...init });
  fireEvent(link, event);
  return event.defaultPrevented;
}

describe("GuardedLink", () => {
  it("with no guard registered a plain click is left to the link: not stopped, no push", () => {
    show(null);
    expect(click()).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("without any provider it is a plain link", () => {
    render(createElement(GuardedLink, { href: "/tavoli" }, "Tavoli"));
    expect(click()).toBe(false);
  });

  it("with a guard that returns false the click is left to the link", () => {
    const guard = vi.fn(() => false);
    show(guard);
    expect(click()).toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("with a guard that returns true the click is stopped, and the guard's go navigates", () => {
    let held: (() => void) | null = null;
    show((go) => {
      held = go;
      return true;
    });
    expect(click()).toBe(true);
    expect(push).not.toHaveBeenCalled();
    held!();
    expect(push).toHaveBeenCalledWith("/tavoli");
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("never intercepts a %s click", (_name, init) => {
    const guard = vi.fn(() => true);
    show(guard);
    expect(click(init)).toBe(false);
    expect(guard).not.toHaveBeenCalled();
  });

  it("stops asking once the page that registered the guard is gone", () => {
    const guard = vi.fn(() => true);
    const view = show(guard);
    view.rerender(createElement(LeaveGuardProvider, null, createElement(Page, { guard: null })));
    expect(click()).toBe(false);
    expect(guard).not.toHaveBeenCalled();
  });
});

describe("useRequestLeave", () => {
  it("runs go at once when there is no guard, or the guard says no", () => {
    const go = vi.fn();
    show(null, go);
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    expect(go).toHaveBeenCalledTimes(1);
    cleanup();
    const go2 = vi.fn();
    show(() => false, go2);
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    expect(go2).toHaveBeenCalledTimes(1);
  });

  it("holds go back when the guard takes over, and runs it only when the guard calls it", () => {
    const go = vi.fn();
    let held: (() => void) | null = null;
    show((resume) => {
      held = resume;
      return true;
    }, go);
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    expect(go).not.toHaveBeenCalled();
    held!();
    expect(go).toHaveBeenCalledTimes(1);
  });
});

// Decision of 2026-11-13: no navigation trap. The browser and phone back gesture stay untouched.
describe("no navigation trap", () => {
  it("nothing in src listens to beforeunload or popstate, or pushes a history entry to catch back", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    const offenders = walk(join(process.cwd(), "src")).filter((file) =>
      /beforeunload|popstate|history\.pushState/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
