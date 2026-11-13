// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_VIEW, type SyncView } from "@/lib/sync/view";

// QW6 (docs/plans/2026-11-13-ux-quick-wins.md): the signed-in person's own name and "Esci" sit in the header band on every
// signed-in screen. The logout is the one `LogoutButton` uses: end the session, forget the user, full load of "/".
let view: SyncView = EMPTY_VIEW;
vi.mock("@/pwa/use-outbox", () => ({ useSyncView: () => view }));
const forgetUser = vi.fn();
vi.mock("@/components/forget-user", () => ({ forgetUser: () => forgetUser() }));
let finishLogout!: () => void;
const apiJson = vi.fn(
  () =>
    new Promise((resolve) => {
      finishLogout = () => resolve({ ok: true, status: 204, data: undefined });
    }),
);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/api/client", () => ({ apiJson: (...args: unknown[]) => apiJson(...(args as [])) }));

const { AccountControl } = await import("@/components/nav/account-control");
const { LeaveGuardProvider, useLeaveGuard } = await import("@/components/nav/leave-guard");
const { ShellBrandLink } = await import("@/components/nav/shell-brand-link");
const replace = vi.fn();

beforeEach(() => {
  view = EMPTY_VIEW;
  forgetUser.mockClear();
  apiJson.mockClear();
  replace.mockClear();
  Object.defineProperty(window, "location", { value: { replace }, configurable: true });
});
afterEach(cleanup);

const withMine = (mine: number): SyncView => ({
  ...EMPTY_VIEW,
  ready: true,
  pending: mine,
  mine,
  visible: true,
});

describe("AccountControl", () => {
  it("shows the signed-in name and exactly one Esci button", () => {
    const { getByRole, getAllByRole, container } = render(
      createElement(AccountControl, { name: "Cameriere Demo" }),
    );
    expect(container.textContent).toContain("Cameriere Demo");
    expect(getAllByRole("button")).toHaveLength(1);
    expect(getByRole("button", { name: "Esci" })).toBeTruthy();
  });

  it("is hidden on a laptop, where the sidebar has its own Esci", () => {
    const { container } = render(createElement(AccountControl, { name: "Utente Demo" }));
    const wrapper = container.querySelector('[data-slot="account-control"]')!;
    expect(wrapper.className).toContain("lg:hidden");
  });

  it("keeps a visible focus ring on the band (band-ink) and a 44 px target", () => {
    const { getByRole } = render(createElement(AccountControl, { name: "Utente Demo" }));
    const button = getByRole("button", { name: "Esci" });
    expect(button.className).toContain("focus-visible:outline-band-ink");
    expect(button.className).toContain("min-h-tap");
  });

  it("logs out: the logout call first, then forgetUser, then a full load of /", async () => {
    const { getByRole } = render(createElement(AccountControl, { name: "Utente Demo" }));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    expect(apiJson).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", body: {} });
    expect(forgetUser).not.toHaveBeenCalled();
    await act(async () => finishLogout());
    expect(forgetUser).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("a second tap while it is logging out does nothing", () => {
    const { getByRole } = render(createElement(AccountControl, { name: "Utente Demo" }));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    expect(apiJson).toHaveBeenCalledTimes(1);
  });

  it("says the unsent operations stay on the phone, in the band ink, and still logs out", async () => {
    view = withMine(3);
    const { getByRole } = render(createElement(AccountControl, { name: "Utente Demo" }));
    expect(() => getByRole("status")).toThrow();
    fireEvent.click(getByRole("button", { name: "Esci" }));
    const status = getByRole("status");
    expect(status.textContent).toBe(
      "Hai 3 operazioni non inviate. Restano su questo telefono e partono quando rientri.",
    );
    expect(status.className).toContain("text-band-ink");
    await act(async () => finishLogout());
    expect(replace).toHaveBeenCalledWith("/");
  });
});

// QW12: "Esci" and the wordmark go through the leave guard of the page. Without a guard nothing changes (the tests above).
describe("the exits in the band ask the page's leave guard", () => {
  let held: (() => void) | null = null;
  function Guarded({ answer }: { answer: boolean }) {
    useLeaveGuard((go) => {
      held = go;
      return answer;
    });
    return createElement(
      "div",
      null,
      createElement(ShellBrandLink),
      createElement(AccountControl, { name: "Utente Demo" }),
    );
  }
  const show = (answer: boolean) =>
    render(createElement(LeaveGuardProvider, null, createElement(Guarded, { answer })));

  beforeEach(() => {
    held = null;
  });

  it("Esci waits for the guard; the guard's go completes the logout", async () => {
    show(true);
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    expect(apiJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    expect(apiJson).not.toHaveBeenCalled();
    held!();
    expect(apiJson).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", body: {} });
    await act(async () => finishLogout());
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("Esci logs out at once when the guard lets it through", async () => {
    show(false);
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    expect(apiJson).toHaveBeenCalledTimes(1);
    await act(async () => finishLogout());
  });

  it("the wordmark link is the band's link to Home and asks the guard on a plain click only", () => {
    show(true);
    const link = screen.getByRole("link", { name: "Osteria Dei Rossi, Home" });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.className).toContain("focus-visible:outline-band-ink");
    expect(link.className).toContain("min-h-tap");
    const plain = createEvent.click(link, { bubbles: true, cancelable: true });
    fireEvent(link, plain);
    expect(plain.defaultPrevented).toBe(true);
    const newTab = createEvent.click(link, { bubbles: true, cancelable: true, metaKey: true });
    fireEvent(link, newTab);
    expect(newTab.defaultPrevented).toBe(false);
  });
});
