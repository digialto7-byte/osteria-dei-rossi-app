// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P2-1 B2: the forced enrolment page /login/attiva-codice. It is a public-layout page (no /api/me call, so no redirect loop).

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const forgetUser = vi.fn();
vi.mock("@/components/forget-user", () => ({ forgetUser: () => forgetUser() }));
vi.mock("@/pwa/use-outbox", () => ({
  useSyncView: () => ({ mine: 0 }),
}));
const paths: string[] = [];
const apiJson = vi.fn((path: string) => {
  paths.push(path);
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
  apiJson: (path: string) => apiJson(path),
}));

import ForcedEnrolPage from "@/app/(public)/login/attiva-codice/page";

beforeEach(() => {
  replace.mockClear();
  forgetUser.mockClear();
  paths.length = 0;
});
afterEach(cleanup);

const open = async (params: Record<string, string> = {}) =>
  render(await ForcedEnrolPage({ searchParams: Promise.resolve(params) }));

describe("/login/attiva-codice", () => {
  it("says why: a heading and the admin rule, and offers Esci", async () => {
    await open();
    expect(
      screen.getByRole("heading", { level: 1, name: "Attiva la verifica in due passaggi" }),
    ).toBeTruthy();
    expect(screen.getByText("Per gli account admin è obbligatoria.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Esci" })).toBeTruthy();
  });

  it("starts the enrolment of the main device, and nothing else, on load", async () => {
    await open();
    await screen.findByAltText("Codice QR per l'app di autenticazione");
    expect(paths).toEqual(["/api/me/mfa/factors"]);
  });

  it("Più tardi after the backup prompt goes to the safe next path and forgets the cached user", async () => {
    await open({ next: "/fatture?x=1" });
    await screen.findByAltText("Codice QR per l'app di autenticazione");
    fireEvent.change(screen.getByLabelText("Codice di 6 cifre"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Attiva" }));
    fireEvent.click(await screen.findByRole("button", { name: "Più tardi" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fatture?x=1"));
    expect(forgetUser).toHaveBeenCalledTimes(1);
  });

  it.each(["https://evil.test/", "//evil.test", "javascript:alert(1)", undefined])(
    "an unsafe next (%s) becomes /",
    async (next) => {
      await open(next === undefined ? {} : { next });
      await screen.findByAltText("Codice QR per l'app di autenticazione");
      fireEvent.change(screen.getByLabelText("Codice di 6 cifre"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "Attiva" }));
      fireEvent.click(await screen.findByRole("button", { name: "Più tardi" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    },
  );

  it("never puts the secret in the page address", async () => {
    await open({ next: "/oggi" });
    await screen.findByAltText("Codice QR per l'app di autenticazione");
    expect(window.location.href).not.toContain("JBSW");
  });
});
