// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const apiJson = vi.fn((path: string, init?: unknown) => {
  calls.push(`api ${path} ${JSON.stringify(init)}`);
  return Promise.resolve({ ok: true, status: 200, data: {} });
});
const replace = vi.fn((path: string) => calls.push(`replace ${path}`));
// A full page load, not router.replace: the proxy must see the request for "/" (the router cache can answer it).
vi.stubGlobal("location", { replace: (path: string) => replace(path) });
const resetMe = vi.fn(() => calls.push("resetMe"));
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: unknown) => apiJson(path, init),
}));
vi.mock("@/components/use-me", () => ({ resetMe: () => resetMe() }));

import { LogoutButton } from "@/components/logout-button";

beforeEach(() => {
  calls.length = 0;
  apiJson.mockClear();
  replace.mockClear();
  resetMe.mockClear();
});
afterEach(cleanup);

describe("LogoutButton", () => {
  it("is a secondary button named Esci", () => {
    render(createElement(LogoutButton));
    expect(screen.getByRole("button", { name: "Esci" })).toBeTruthy();
  });

  it("posts the logout once, forgets the cached user, then goes to / (the proxy picks /pin or /login)", async () => {
    render(createElement(LogoutButton));
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'api /api/auth/logout {"method":"POST","body":{}}',
      "resetMe",
      "replace /",
    ]);
  });

  it("ignores a second tap while the first is on its way", async () => {
    render(createElement(LogoutButton));
    const button = screen.getByRole("button", { name: "Esci" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(apiJson).toHaveBeenCalledTimes(1);
  });

  it("still leaves when the server cannot be reached, so the shared device is not stuck", async () => {
    apiJson.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as never,
        status: 0 as never,
        data: undefined as never,
      }),
    );
    render(createElement(LogoutButton));
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(resetMe).toHaveBeenCalledTimes(1);
  });

  it("puts a class on the wrapper, to hide the one on Oggi on a laptop", () => {
    render(createElement(LogoutButton, { className: "lg:hidden" }));
    expect(screen.getByRole("button", { name: "Esci" }).parentElement?.className).toContain(
      "lg:hidden",
    );
  });
});
