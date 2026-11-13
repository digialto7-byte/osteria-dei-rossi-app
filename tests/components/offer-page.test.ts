// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P2-1 B4: /login/offerta-codice. An owner or admin without a factor is offered the code; "Non ora" continues with no request at all.

const calls: { path: string; method: string | undefined; body: unknown }[] = [];
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, method: init?.method, body: init?.body });
  if (path === "/api/me/mfa/factors")
    return Promise.resolve({
      ok: true,
      status: 201,
      data: {
        factorId: "11111111-1111-4111-8111-111111111111",
        slot: "principale",
        qrImage: "data:image/svg+xml;utf-8,%3Csvg%3E",
        secret: "JBSWY3DPEHPK3PXP",
      },
    });
  return Promise.resolve({ ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const forgetUser = vi.fn();
vi.mock("@/components/forget-user", () => ({ forgetUser: () => forgetUser() }));

import OfferPage from "@/app/(public)/login/offerta-codice/page";

beforeEach(() => {
  calls.length = 0;
  apiJson.mockClear();
  replace.mockClear();
  forgetUser.mockClear();
});
afterEach(cleanup);

const open = async (params: Record<string, string> = {}) =>
  render(await OfferPage({ searchParams: Promise.resolve(params) }));

describe("/login/offerta-codice", () => {
  it("offers the code in plain words and sends nothing until a button is pressed", async () => {
    await open({ next: "/oggi" });
    expect(screen.getByRole("heading", { level: 1, name: "Proteggi il tuo accesso" })).toBeTruthy();
    expect(
      screen.getByText("Oltre alla password, servirà un codice dal tuo telefono."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attiva ora" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Non ora" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("Non ora continues to next with no request", async () => {
    await open({ next: "/fatture" });
    fireEvent.click(screen.getByRole("button", { name: "Non ora" }));
    expect(replace).toHaveBeenCalledWith("/fatture");
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("an unsafe next becomes / for Non ora", async () => {
    await open({ next: "//evil.test" });
    fireEvent.click(screen.getByRole("button", { name: "Non ora" }));
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("Attiva ora opens the enrolment for the main device: one request, slot principale", async () => {
    await open({ next: "/oggi" });
    fireEvent.click(screen.getByRole("button", { name: "Attiva ora" }));
    await screen.findByAltText("Codice QR per l'app di autenticazione");
    expect(calls).toEqual([
      { path: "/api/me/mfa/factors", method: "POST", body: { slot: "principale" } },
    ]);
    expect(screen.queryByRole("button", { name: "Non ora" })).toBeNull();
  });

  it("Annulla inside the enrolment goes back to the offer", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Attiva ora" }));
    await screen.findByAltText("Codice QR per l'app di autenticazione");
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.getByRole("button", { name: "Attiva ora" })).toBeTruthy();
  });

  it("a finished enrolment follows next and offers the backup first", async () => {
    await open({ next: "/magazzino" });
    fireEvent.click(screen.getByRole("button", { name: "Attiva ora" }));
    await screen.findByAltText("Codice QR per l'app di autenticazione");
    fireEvent.change(screen.getByLabelText("Codice di 6 cifre"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Attiva" }));
    fireEvent.click(await screen.findByRole("button", { name: "Più tardi" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/magazzino"));
  });

  it("makes every button a 44 px target", async () => {
    await open();
    for (const button of screen.getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("min-h-tap");
    }
  });
});
