// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

let reply: Result;
const apiJson = vi.fn((_path: string): Promise<Result> => Promise.resolve(reply));
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import { DemoBanner, DemoBannerView } from "@/app/(owner)/demo-banner";
import { resetMe } from "@/components/use-me";

const me = (role: string, isDemo: boolean): Result => ({
  ok: true,
  status: 200,
  data: { user: { role }, tenant: { id: "t", name: "Osteria Demo (dati di prova)", isDemo } },
});

beforeEach(() => {
  // useMe keeps one /api/me answer per session; every case starts a new session.
  resetMe();
  apiJson.mockClear();
});
afterEach(cleanup);

describe("DemoBannerView", () => {
  it("a demo tenant: the notice, and the link to the purge page for the owner", () => {
    render(createElement(DemoBannerView, { isDemo: true, role: "owner" }));
    expect(screen.getByText("Dati di prova — non sono dati reali.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Elimina dati di prova" });
    expect(link.getAttribute("href")).toBe("/impostazioni/dati-di-prova");
  });

  it.each(["admin", "chef", "waiter"])("%s sees the notice and no link", (role) => {
    render(createElement(DemoBannerView, { isDemo: true, role }));
    expect(screen.getByText("Dati di prova — non sono dati reali.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("not a demo: nothing is rendered", () => {
    const { container } = render(createElement(DemoBannerView, { isDemo: false, role: "owner" }));
    expect(container.innerHTML).toBe("");
  });
});

describe("DemoBanner", () => {
  it("reads /api/me once and shows the banner for a demo owner", async () => {
    reply = me("owner", true);
    render(createElement(DemoBanner));
    await screen.findByText("Dati di prova — non sono dati reali.");
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(apiJson).toHaveBeenCalledWith("/api/me");
    expect(screen.getByRole("link", { name: "Elimina dati di prova" })).toBeTruthy();
  });

  it("a real tenant: nothing", async () => {
    reply = me("owner", false);
    const { container } = render(createElement(DemoBanner));
    await waitFor(() => expect(apiJson).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.innerHTML).toBe("");
  });

  it("a failed /api/me: nothing, no error text", async () => {
    reply = { ok: false, status: 401, error: { code: "unauthenticated", message: "x" } };
    const { container } = render(createElement(DemoBanner));
    await waitFor(() => expect(apiJson).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.innerHTML).toBe("");
  });
});
