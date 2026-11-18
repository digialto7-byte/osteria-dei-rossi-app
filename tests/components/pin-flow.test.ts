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
const pinBodies: unknown[] = [];
let pinReply: Reply;
let pinGate: Promise<void> | null = null;
const apiJson = vi.fn((path: string, init?: unknown): Promise<Reply> => {
  if (path === "/api/auth/device") {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: { enrolled: true, label: "Telefono sala (demo)", locked: false, staff: [WAITER, CHEF] },
    });
  }
  order.push(`post ${path}`);
  pinBodies.push((init as { body?: unknown } | undefined)?.body);
  return pinGate ? pinGate.then(() => pinReply) : Promise.resolve(pinReply);
});
const replace = vi.fn((path: string) => order.push(`replace ${path}`));
const resetMe = vi.fn(() => order.push("resetMe"));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: unknown) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/use-me", () => ({ resetMe: () => resetMe() }));

import { PinFlow } from "@/app/(public)/pin/pin-flow";

beforeEach(() => {
  order.length = 0;
  pinBodies.length = 0;
  pinGate = null;
  replace.mockClear();
  resetMe.mockClear();
});
afterEach(cleanup);

async function enter(name: string) {
  render(createElement(PinFlow));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  // The fourth digit is the submit: no click on "Entra".
  fireEvent.change(await screen.findByLabelText("PIN"), { target: { value: "4827" } });
}

const loggedIn = (user: object): Reply => ({
  ok: true,
  status: 200,
  data: { user, endsAt: "2026-10-28T23:00:00.000Z" },
});

describe("PinFlow inside /login (M25a)", () => {
  it("tells /login when the device is not enrolled, instead of showing its own card", async () => {
    apiJson.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 200, data: { enrolled: false } }),
    );
    const onNotEnrolled = vi.fn();
    render(createElement(PinFlow, { onNotEnrolled }));
    await waitFor(() => expect(onNotEnrolled).toHaveBeenCalledTimes(1));
  });

  it("tells /login once, with the revoked flag, for a device the server says was revoked", async () => {
    apiJson.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 200, data: { enrolled: false, revoked: true } }),
    );
    const onNotEnrolled = vi.fn();
    const view = render(createElement(PinFlow, { onNotEnrolled }));
    await waitFor(() => expect(onNotEnrolled).toHaveBeenCalledTimes(1));
    view.rerender(createElement(PinFlow, { onNotEnrolled }));
    expect(onNotEnrolled).toHaveBeenCalledTimes(1);
    expect(onNotEnrolled).toHaveBeenCalledWith({ revoked: true });
  });

  it("names the enabled phone when asked", async () => {
    render(createElement(PinFlow, { showEnabled: true }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Telefono abilitato: Telefono sala (demo).",
    );
  });

  it("shows no status note by default", async () => {
    render(createElement(PinFlow));
    await screen.findByRole("heading", { name: "Chi sei?" });
    expect(screen.queryByRole("status")).toBeNull();
  });
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

describe("PinFlow, the fourth digit submits", () => {
  const openPad = async () => {
    render(createElement(PinFlow));
    fireEvent.click(await screen.findByRole("button", { name: /Cameriere Demo/ }));
    return (await screen.findByLabelText("PIN")) as HTMLInputElement;
  };

  it("typing four digits posts that PIN once, with no click", async () => {
    pinReply = loggedIn(WAITER);
    const field = await openPad();
    for (const value of ["4", "48", "482", "4827"]) fireEvent.change(field, { target: { value } });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tavoli"));
    expect(pinBodies).toEqual([{ userId: WAITER.id, pin: "4827" }]);
  });

  it("three digits do not submit", async () => {
    pinReply = loggedIn(WAITER);
    const field = await openPad();
    fireEvent.change(field, { target: { value: "482" } });
    await Promise.resolve();
    expect(pinBodies).toHaveLength(0);
    expect(field.value).toBe("482");
  });

  it("a paste of four digits submits once", async () => {
    pinReply = loggedIn(WAITER);
    const field = await openPad();
    fireEvent.paste(field, { clipboardData: { getData: () => "4827" } });
    fireEvent.change(field, { target: { value: "4827" } });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(pinBodies).toEqual([{ userId: WAITER.id, pin: "4827" }]);
  });

  it("Enter right after the auto-submit does not send a second request", async () => {
    let release!: () => void;
    pinGate = new Promise<void>((resolve) => (release = resolve));
    pinReply = loggedIn(WAITER);
    const field = await openPad();
    fireEvent.change(field, { target: { value: "4827" } });
    fireEvent.submit(field.closest("form")!);
    fireEvent.submit(field.closest("form")!);
    expect(pinBodies).toHaveLength(1);
    release();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tavoli"));
    expect(pinBodies).toHaveLength(1);
  });

  it("a wrong PIN clears the field and shows the alert", async () => {
    pinReply = { ok: false, status: 401, error: { code: "invalid_pin", message: "PIN errato." } };
    const field = await openPad();
    fireEvent.change(field, { target: { value: "0000" } });
    await screen.findByRole("alert");
    expect(field.value).toBe("");
  });
});
