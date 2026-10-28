// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WAITER = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Cameriere Demo",
  role: "waiter",
};
const CHEF = {
  id: "22222222-2222-4222-8222-222222222222",
  displayName: "Cuoco Demo",
  role: "chef",
};

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const order: string[] = [];
let pinReply: Reply;
const apiJson = vi.fn((path: string): Promise<Reply> => {
  if (path === "/api/auth/device") {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: { enrolled: true, label: "Telefono sala (demo)", locked: false, staff: [WAITER, CHEF] },
    });
  }
  order.push(`post ${path}`);
  return Promise.resolve(pinReply);
});
const replace = vi.fn((path: string) => order.push(`replace ${path}`));
const resetMe = vi.fn(() => order.push("resetMe"));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string) => apiJson(path),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/use-me", () => ({ resetMe: () => resetMe() }));

import { PinFlow } from "@/app/(public)/pin/pin-flow";

beforeEach(() => {
  order.length = 0;
  replace.mockClear();
  resetMe.mockClear();
});
afterEach(cleanup);

async function enter(name: string) {
  render(createElement(PinFlow));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  fireEvent.change(await screen.findByLabelText("PIN"), { target: { value: "4827" } });
  fireEvent.click(screen.getByRole("button", { name: "Entra" }));
}

const loggedIn = (user: object): Reply => ({
  ok: true,
  status: 200,
  data: { user, endsAt: "2026-10-28T23:00:00.000Z" },
});

describe("PinFlow, where a person lands", () => {
  it("sends the waiter straight to the tables, after forgetting the cached user", async () => {
    pinReply = loggedIn(WAITER);
    await enter("Cameriere Demo");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tavoli"));
    expect(order).toEqual(["post /api/auth/pin", "resetMe", "replace /tavoli"]);
  });

  it("sends the chef to Oggi, after forgetting the cached user", async () => {
    pinReply = loggedIn(CHEF);
    await enter("Cuoco Demo");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(order).toEqual(["post /api/auth/pin", "resetMe", "replace /"]);
  });

  it("stays on the pad after a wrong PIN: no redirect and the cache is kept", async () => {
    pinReply = {
      ok: false,
      status: 401,
      error: { code: "invalid_pin", message: "PIN errato." },
    };
    await enter("Cameriere Demo");
    await waitFor(() => expect(order).toContain("post /api/auth/pin"));
    await screen.findByRole("alert");
    expect(replace).not.toHaveBeenCalled();
    expect(resetMe).not.toHaveBeenCalled();
  });
});
