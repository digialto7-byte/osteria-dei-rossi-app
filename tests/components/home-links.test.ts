// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let role = "owner";
let isDemo = false;
vi.mock("@/lib/api/client", () => ({
  apiJson: () =>
    Promise.resolve({
      ok: true,
      status: 200,
      data: {
        user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
        tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo", isDemo },
      },
    }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import HomePage from "@/app/(owner)/page";

beforeEach(() => {
  role = "owner";
  isDemo = false;
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

// The demo notice of every signed-in page, home included, comes from the (owner) layout
// (tests/components/owner-layout.test.ts). The home page must not draw a second one.
describe("Home page demo banner", () => {
  it.each(["owner", "waiter"])("draws no banner of its own for a demo tenant's %s", async (who) => {
    isDemo = true;
    role = who;
    render(createElement(HomePage));
    await screen.findByRole("heading", { name: /Utente Demo/ });
    expect(screen.queryByText("Dati di prova — non sono dati reali.")).toBeNull();
    expect(link("Elimina dati di prova")).toBeNull();
  });
});
