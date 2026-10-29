// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { PLATE } from "./cost-fixtures";

// UX plan C5 (P2-5, N7): the three sub-pages of Costi are links at the top of the screen, before the plate list, so they
// are not hidden below a long list.

let plates = [PLATE];
let slow = false;
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  if (path === "/api/me") {
    return ok({
      user: {
        id: "a0000000-0000-4000-8000-000000000001",
        displayName: "Utente Demo",
        role: "owner",
      },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    });
  }
  if (slow) return new Promise(() => {});
  return ok({ at: null, fixedCost: null, plates });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import CostsPage from "@/app/(owner)/costi/page";

beforeEach(() => {
  resetMe();
  plates = [PLATE];
  slow = false;
});
afterEach(cleanup);

const SUBPAGES = [
  ["Costi degli ingredienti", "/costi/ingredienti"],
  ["Impostazioni dei costi", "/costi/impostazioni"],
  ["Confronta con il foglio dello chef", "/costi/verifica"],
] as const;

const follows = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("Costi sub-links", () => {
  it("renders the three links before the plate list", async () => {
    render(createElement(CostsPage));
    const list = await screen.findByRole("list");
    const links = SUBPAGES.map(([name, href]) => {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      return link;
    });
    for (const link of links) expect(follows(link, list)).toBe(true);
  });

  it("keeps them in the same order as before", async () => {
    render(createElement(CostsPage));
    await screen.findByRole("list");
    const hrefs = SUBPAGES.map(([name]) => screen.getByRole("link", { name }));
    expect(follows(hrefs[0]!, hrefs[1]!) && follows(hrefs[1]!, hrefs[2]!)).toBe(true);
  });

  it("shows them while the plates are still loading", () => {
    slow = true;
    render(createElement(CostsPage));
    for (const [name] of SUBPAGES) expect(screen.getByRole("link", { name })).toBeTruthy();
  });

  it("shows them above the empty state too", async () => {
    plates = [];
    render(createElement(CostsPage));
    await screen.findByText("Nessun piatto attivo.");
    for (const [name] of SUBPAGES) expect(screen.getByRole("link", { name })).toBeTruthy();
  });
});
