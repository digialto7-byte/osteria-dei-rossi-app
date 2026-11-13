// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ING, ITEM } from "./stock-fixtures";

// QW9: the stock list opened with ?azione=spreco (the Home shortcut "Registra uno spreco") links every row to the waste form.
const apiJson = vi.fn((path: string) => {
  if (path === "/api/me") {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        user: { id: "u1", displayName: "Utente Demo", role: "chef" },
        tenant: { id: "t1", name: "Osteria Demo" },
      },
    });
  }
  if (path.startsWith("/api/stock")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: { asOf: "2026-11-13T10:00:00Z", items: [ITEM] },
    });
  }
  if (path === "/api/locations") {
    return Promise.resolve({ ok: true, status: 200, data: { locations: [] } });
  }
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import StockPage from "@/app/(owner)/magazzino/page";
import { resetMe } from "@/components/use-me";

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const rowLink = async () => screen.findByRole("link", { name: "Manzo muscolo (demo)" });

describe("the stock list and ?azione=spreco (QW9)", () => {
  it("links the rows to the waste form when opened for a waste", async () => {
    window.history.replaceState(null, "", "/magazzino?azione=spreco");
    render(createElement(StockPage));
    expect((await rowLink()).getAttribute("href")).toBe(`/magazzino/${ING}#spreco`);
  });

  it("links the rows to the ingredient page as before without the action", async () => {
    window.history.replaceState(null, "", "/magazzino");
    render(createElement(StockPage));
    expect((await rowLink()).getAttribute("href")).toBe(`/magazzino/${ING}`);
  });
});
