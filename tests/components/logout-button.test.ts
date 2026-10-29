// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_VIEW, type SyncView } from "@/lib/sync/view";

// "Esci" (M20 plan §3.1.9, Q125 default): it forgets the user and clears the worker's read cache, warns when the person has operations
// that are not sent yet, and still logs out - the operations stay on the phone and go out when that person signs in again.
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
vi.mock("@/lib/api/client", () => ({ apiJson: (...args: unknown[]) => apiJson(...(args as [])) }));

const { LogoutButton } = await import("@/components/logout-button");
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

describe("LogoutButton", () => {
  it("logs out: ends the session, forgets the user (and tells the worker), goes to /", async () => {
    const { getByRole } = render(createElement(LogoutButton));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    expect(apiJson).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", body: {} });
    expect(forgetUser).not.toHaveBeenCalled();
    await act(async () => finishLogout());
    expect(forgetUser).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("with nothing waiting it shows no warning", async () => {
    const { getByRole, queryByRole } = render(createElement(LogoutButton));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    expect(queryByRole("status")).toBeNull();
    await act(async () => finishLogout());
  });

  it("with 3 operations of the person not sent, it says they stay on the phone - and still logs out", async () => {
    view = withMine(3);
    const { getByRole } = render(createElement(LogoutButton));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    expect(getByRole("status").textContent).toBe(
      "Hai 3 operazioni non inviate. Restano su questo telefono e partono quando rientri.",
    );
    await act(async () => finishLogout());
    expect(forgetUser).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("one operation reads in the singular", () => {
    view = withMine(1);
    const { getByRole } = render(createElement(LogoutButton));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    expect(getByRole("status").textContent).toBe(
      "Hai 1 operazione non inviata. Resta su questo telefono e parte quando rientri.",
    );
  });

  it("leaves even when the logout request failed (the device must not stay on the previous person's screen)", async () => {
    apiJson.mockImplementationOnce(
      () =>
        Promise.resolve({
          ok: false,
          status: 0,
          error: { code: "network", message: "x" },
        }) as never,
    );
    const { getByRole } = render(createElement(LogoutButton));
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Esci" }));
    });
    expect(forgetUser).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("a second tap while it is logging out does nothing", () => {
    const { getByRole } = render(createElement(LogoutButton));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    fireEvent.click(getByRole("button", { name: "Esci" }));
    expect(apiJson).toHaveBeenCalledTimes(1);
  });
});
