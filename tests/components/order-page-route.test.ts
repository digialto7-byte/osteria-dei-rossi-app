// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The comanda reads its session from ?s= (M20 plan §3.6.4); a missing or malformed id is "Tavolo non trovato." with a way back.
let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
const apiJson = vi.fn();
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (...args: unknown[]) => apiJson(...args),
}));

import OrderPage from "@/app/(owner)/tavoli/comanda/page";

afterEach(() => {
  cleanup();
  apiJson.mockReset();
});

describe("Comanda page: the session in the address", () => {
  it.each([
    [""],
    ["s=x"],
    ["s="],
    ["s=5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f&s=5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f"],
  ])("%j: says the table was not found, links back to the tables and reads nothing", (value) => {
    query = value;
    render(createElement(OrderPage));
    expect(screen.getByRole("heading", { name: "Tavolo non trovato." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Tavoli" }).getAttribute("href")).toBe("/tavoli");
    expect(apiJson).not.toHaveBeenCalled();
  });
});
