// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let role = "owner";
let isDemo = false;
const apiJson = vi.fn((_path: string) =>
  Promise.resolve({
    ok: true,
    status: 200,
    data: {
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo", isDemo },
    },
  }),
);
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import HomePage from "@/app/(owner)/page";
import { resetMe } from "@/components/use-me";

beforeEach(() => {
  // useMe keeps one /api/me answer per session; every case starts a new one.
  resetMe();
  apiJson.mockClear();
  replace.mockClear();
  role = "owner";
  isDemo = false;
});
afterEach(cleanup);

const link = (name: string) => screen.queryByRole("link", { name: new RegExp(`^${name}`) });
const open = async (who: string) => {
  role = who;
  const view = render(createElement(HomePage));
  await screen.findByRole("heading", { name: /Utente Demo/ });
  return view;
};

describe("Oggi, the home page", () => {
  it("reads /api/me once", async () => {
    await open("owner");
    expect(apiJson.mock.calls.filter(([path]) => path === "/api/me")).toHaveLength(1);
  });

  it("shows the account card, with the role word the e2e suite reads", async () => {
    await open("owner");
    expect(screen.getByText("Osteria Demo")).toBeTruthy();
    expect(screen.getByTestId("role").textContent).toBe("Ruolo: Titolare");
  });

  it("gives the owner Carica una fattura as the one primary action, to /fatture", async () => {
    const { container } = await open("owner");
    expect(link("Carica una fattura")?.getAttribute("href")).toBe("/fatture");
    const primaries = [...container.querySelectorAll("a")].filter((a) =>
      a.className.includes("bg-accent"),
    );
    expect(primaries.map((a) => a.textContent)).toEqual(["Carica una fattura"]);
  });

  it.each(["owner", "admin", "chef"])("gives the %s exactly one primary link", async (who) => {
    const { container } = await open(who);
    const primaries = [...container.querySelectorAll("a")].filter((a) =>
      a.className.includes("bg-accent"),
    );
    expect(primaries).toHaveLength(1);
  });

  it.each(["owner", "admin"])("%s has the links to the tables and the menu", async (who) => {
    await open(who);
    expect(link("Tavoli")?.getAttribute("href")).toBe("/tavoli");
    expect(link("Menu e prezzi")?.getAttribute("href")).toBe("/menu");
  });

  it("gives the admin the staff and devices first, and no alerts", async () => {
    await open("admin");
    expect(link("Personale e dispositivi")?.getAttribute("href")).toBe("/personale");
    expect(link("Avvisi")).toBeNull();
  });

  it("gives the owner and the admin the first-steps list, with six steps", async () => {
    for (const who of ["owner", "admin"]) {
      const { container } = await open(who);
      const heading = screen.getByRole("heading", { name: "Primi passi" });
      const list = heading.parentElement!.querySelector("ul")!;
      expect(list.querySelectorAll("a")).toHaveLength(6);
      expect(container.textContent).toContain("Carica la prima fattura");
      cleanup();
    }
  });

  it("gives the chef the kitchen jobs, no first steps, no money and no euro sign", async () => {
    const { container } = await open("chef");
    expect(link("Nuova produzione")?.getAttribute("href")).toBe("/produzione/nuova");
    expect(link("Conteggio giornaliero")?.getAttribute("href")).toBe("/magazzino/conteggi");
    expect(link("Registra uno spreco")?.getAttribute("href")).toBe("/magazzino");
    expect(screen.queryByRole("heading", { name: "Primi passi" })).toBeNull();
    for (const forbidden of ["/pagamenti", "/costi", "/fatture", "/menu", "/tavoli"]) {
      expect(container.querySelector(`a[href="${forbidden}"]`), forbidden).toBeNull();
    }
    expect(container.textContent).not.toContain("€");
  });

  it("sends the waiter to the tables and renders nothing", async () => {
    role = "waiter";
    const { container } = render(createElement(HomePage));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tavoli"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe("");
  });

  it.each(["owner", "admin", "chef"])("does not redirect the %s", async (who) => {
    await open(who);
    expect(replace).not.toHaveBeenCalled();
  });

  it("has one Esci button, hidden on a laptop where the sidebar has it", async () => {
    await open("chef");
    const button = screen.getByRole("button", { name: "Esci" });
    expect(button.parentElement?.className).toContain("lg:hidden");
  });

  it("says so when the account is enabled for no venue", async () => {
    apiJson.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        error: { code: "no_tenant", message: "x" },
      } as never),
    );
    render(createElement(HomePage));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("non è abilitato");
  });

  it("offers the login when signed out", async () => {
    apiJson.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        error: { code: "unauthenticated", message: "x" },
      } as never),
    );
    render(createElement(HomePage));
    expect((await screen.findByRole("link", { name: "Accedi" })).getAttribute("href")).toBe(
      "/login",
    );
  });
});

// The demo notice of every signed-in page, home included, comes from the (owner) layout
// (tests/components/owner-layout.test.ts). The home page must not draw a second one.
describe("Home page demo banner", () => {
  it.each(["owner", "chef"])("draws no banner of its own for a demo tenant's %s", async (who) => {
    isDemo = true;
    role = who;
    render(createElement(HomePage));
    await screen.findByRole("heading", { name: /Utente Demo/ });
    expect(screen.queryByText("Dati di prova — non sono dati reali.")).toBeNull();
    expect(link("Elimina dati di prova")).toBeNull();
  });
});
