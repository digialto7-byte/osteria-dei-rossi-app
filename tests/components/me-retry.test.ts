// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

vi.mock("next/navigation", () => ({
  usePathname: () => "/fatture",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// M20: the shell starts the offline queue for a table operator. This test is about /api/me, and a jsdom page has no IndexedDB (the queue
// would say so in a banner), so the queue hooks are inert here.
vi.mock("@/pwa/use-outbox", async () => {
  const { EMPTY_VIEW } = await import("@/lib/sync/view");
  return {
    useSyncBoot: () => undefined,
    useSyncView: () => EMPTY_VIEW,
    markNoticesSeen: async () => undefined,
  };
});

import { AppShell } from "@/app/(owner)/app-shell";
import InvoicesPage from "@/app/(owner)/fatture/page";

const ME = {
  user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role: "owner" },
  tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo", isDemo: true },
};
let meCalls = 0;
let failFirst = true;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  resetMe();
  meCalls = 0;
  failFirst = true;
  vi.stubGlobal("fetch", (path: string) => {
    if (path === "/api/me") {
      meCalls += 1;
      return failFirst && meCalls === 1
        ? json(500, { error: { code: "boom", message: "x" } })
        : json(200, ME);
    }
    if (path.startsWith("/api/invoices")) return json(200, { invoices: [] });
    return json(404, { error: { code: "not_found", message: "x" } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BANNER = "Dati di prova — non sono dati reali.";
const renderShellWithPage = () =>
  render(createElement(AppShell, null, createElement(InvoicesPage)));

// The layout stays mounted while a page changes, so one /api/me answer must reach the shell, the banner and the page.
describe("Riprova after /api/me failed", () => {
  it("shows the error and no navigation first", async () => {
    renderShellWithPage();
    const alert = await within(screen.getByRole("main")).findByRole("alert");
    expect(alert.textContent).toContain("Non riusciamo a verificare");
    expect(screen.queryByRole("navigation", { name: "Sezioni" })).toBeNull();
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("the shell gets its navigation and the banner appears, not just the page", async () => {
    renderShellWithPage();
    fireEvent.click(await screen.findByRole("button", { name: "Riprova" }));
    // The shell's tab bar, the sidebar and the demo banner all hear the same answer.
    const bar = await screen.findByRole("navigation", { name: "Sezioni" });
    expect(
      within(bar)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Oggi", "Acquisti", "Cucina", "Sala", "Gestione"]);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(screen.getAllByRole("navigation", { name: "Menu principale" }).length).toBeGreaterThan(
      0,
    );
    // ...and the page itself recovered.
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks /api/me once more, not once per component", async () => {
    renderShellWithPage();
    fireEvent.click(await screen.findByRole("button", { name: "Riprova" }));
    await screen.findByRole("navigation", { name: "Sezioni" });
    expect(meCalls).toBe(2);
  });
});
