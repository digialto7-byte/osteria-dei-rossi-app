import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The service worker caches the comanda's HTML once per path (query dropped) and serves it for any ?s= offline. So the server output,
// and what React hydrates against, must be the same whatever the query: the session is read only after mount.
let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));

import OrderPage from "@/app/(owner)/tavoli/comanda/page";

const SESSION_A = "5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f";
const SESSION_B = "6c1d0a1f-2d2e-4c6f-8e6b-1b2c3d4e5f60";
const serverHtml = (value: string) => {
  query = value;
  return renderToString(createElement(OrderPage));
};

describe("Comanda page: server output", () => {
  it("is byte-identical with ?s=A, ?s=B, no ?s and a malformed ?s", () => {
    const none = serverHtml("");
    expect(serverHtml(`s=${SESSION_A}`)).toBe(none);
    expect(serverHtml(`s=${SESSION_B}&tab=1`)).toBe(none);
    expect(serverHtml("s=x")).toBe(none);
  });

  it("is the loading state, not the missing-session page or the order screen", () => {
    const html = serverHtml(`s=${SESSION_A}`);
    expect(html).toContain("Caricamento");
    expect(html).not.toContain("Tavolo non trovato.");
    expect(html).not.toContain(SESSION_A);
  });
});
