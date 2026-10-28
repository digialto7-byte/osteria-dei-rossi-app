// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let role = "owner";
vi.mock("@/lib/api/client", () => ({
  apiJson: () =>
    Promise.resolve({
      ok: true,
      status: 200,
      data: {
        user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
        tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
      },
    }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import HomePage from "@/app/page";

beforeEach(() => {
  role = "owner";
});
afterEach(cleanup);

const link = (name: string) => screen.queryByRole("link", { name: new RegExp(`^${name}`) });

describe("Home links of M17", () => {
  it.each(["owner", "admin", "waiter"])("%s has the link to the tables", async (who) => {
    role = who;
    render(createElement(HomePage));
    await screen.findByRole("heading", { name: /Utente Demo/ });
    expect(link("Tavoli")?.getAttribute("href")).toBe("/tavoli");
  });

  it.each(["owner", "admin"])("%s has the link to the menu", async (who) => {
    role = who;
    render(createElement(HomePage));
    await screen.findByRole("heading", { name: /Utente Demo/ });
    expect(link("Menu e prezzi")?.getAttribute("href")).toBe("/menu");
  });

  it("the chef has neither link and the waiter has no menu link", async () => {
    role = "chef";
    const { unmount } = render(createElement(HomePage));
    await screen.findByRole("heading", { name: /Utente Demo/ });
    expect(link("Tavoli")).toBeNull();
    expect(link("Menu e prezzi")).toBeNull();
    unmount();
    role = "waiter";
    render(createElement(HomePage));
    await screen.findByRole("heading", { name: /Utente Demo/ });
    expect(link("Menu e prezzi")).toBeNull();
  });
});

describe("Home link of M19", () => {
  it.each(["owner", "admin", "chef"])("%s has the link to the kitchen", async (who) => {
    role = who;
    render(createElement(HomePage));
    await screen.findByRole("heading", { name: /Utente Demo/ });
    expect(link("Cucina")?.getAttribute("href")).toBe("/cucina");
  });

  it("the waiter has none", async () => {
    role = "waiter";
    render(createElement(HomePage));
    await screen.findByRole("heading", { name: /Utente Demo/ });
    expect(link("Cucina")).toBeNull();
  });
});
