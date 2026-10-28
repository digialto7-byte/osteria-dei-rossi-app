// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

vi.mock("next/navigation", () => ({
  usePathname: () => "/fatture",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import OwnerLayout from "@/app/(owner)/layout";

let role = "owner";
let isDemo = false;
beforeEach(() => {
  resetMe();
  role = "owner";
  isDemo = false;
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
          tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo", isDemo },
        }),
        { status: 200 },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BANNER = "Dati di prova — non sono dati reali.";
const renderPage = () =>
  render(createElement(OwnerLayout, null, createElement("h1", null, "Pagina")));

// Every signed-in page, home included, gets the demo notice from this one layout (CLAUDE.md demo-data).
describe("the signed-in layout and the demo banner", () => {
  it("a demo tenant's owner sees one banner and one link to the reset page", async () => {
    isDemo = true;
    renderPage();
    await waitFor(() => expect(screen.getAllByText(BANNER)).toHaveLength(1));
    const links = screen.getAllByRole("link", { name: "Elimina dati di prova" });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/impostazioni/dati-di-prova");
  });

  it("a waiter of a demo tenant sees the banner but not the link", async () => {
    isDemo = true;
    role = "waiter";
    renderPage();
    await waitFor(() => expect(screen.getAllByText(BANNER)).toHaveLength(1));
    expect(screen.queryByRole("link", { name: "Elimina dati di prova" })).toBeNull();
  });

  it("a tenant without demo data shows no banner", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Pagina" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(BANNER)).toBeNull();
  });
});

describe("the signed-in layout and the page", () => {
  it("renders the page inside exactly one main", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Pagina" });
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main").contains(screen.getByRole("heading", { name: "Pagina" }))).toBe(
      true,
    );
  });
});
