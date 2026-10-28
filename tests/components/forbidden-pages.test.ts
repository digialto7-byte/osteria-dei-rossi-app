// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

let role = "owner";
let meFailure: "none" | "500" | "network" | "401" = "none";
const paths: string[] = [];
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  paths.push(path);
  if (path === "/api/me" && meFailure === "500") {
    return Promise.resolve({ ok: false, status: 500, error: { code: "boom", message: "x" } });
  }
  if (path === "/api/me" && meFailure === "network") {
    return Promise.resolve({ ok: false, status: 0, error: { code: "network", message: "x" } });
  }
  if (path === "/api/me" && meFailure === "401") {
    return Promise.resolve({
      ok: false,
      status: 401,
      error: { code: "unauthenticated", message: "x" },
    });
  }
  if (path === "/api/me") {
    return ok({
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    });
  }
  if (path === "/api/invoices") return ok({ invoices: [] });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string) => apiJson(path),
  apiUpload: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import ImportPage from "@/app/(owner)/anagrafiche/importa/page";
import InvoicesPage from "@/app/(owner)/fatture/page";

beforeEach(() => {
  resetMe();
  role = "owner";
  meFailure = "none";
  paths.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const fileInputs = () => document.querySelectorAll('input[type="file"]');

describe("/fatture", () => {
  it.each(["chef", "waiter"])("tells the %s once and offers no upload and no list", async (who) => {
    role = who;
    render(createElement(InvoicesPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Le fatture non sono disponibili per il tuo ruolo.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(fileInputs()).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    expect(paths).not.toContain("/api/invoices");
  });

  it.each(["owner", "admin"])("shows the %s the upload form and reads the list", async (who) => {
    role = who;
    render(createElement(InvoicesPage));
    await waitFor(() => expect(fileInputs().length).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(paths).toContain("/api/invoices"));
  });

  it("shows neither the notice nor the form while the role is unknown", () => {
    render(createElement(InvoicesPage));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fileInputs()).toHaveLength(0);
  });
});

describe("/anagrafiche/importa", () => {
  it.each(["chef", "waiter"])("tells the %s once and offers no file picker", async (who) => {
    role = who;
    render(createElement(ImportPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("L'importazione non è disponibile per il tuo ruolo.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(fileInputs()).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["owner", "admin"])("shows the %s the import form", async (who) => {
    role = who;
    render(createElement(ImportPage));
    await waitFor(() => expect(fileInputs().length).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("when /api/me itself fails", () => {
  const PAGES = [
    ["/fatture", () => createElement(InvoicesPage)],
    ["/anagrafiche/importa", () => createElement(ImportPage)],
  ] as const;

  it.each(PAGES)(
    "%s shows an alert with a retry on a 500, not a bare heading",
    async (_name, page) => {
      meFailure = "500";
      render(page());
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Non riusciamo a verificare");
      expect(screen.getByRole("button", { name: "Riprova" })).toBeTruthy();
      expect(fileInputs()).toHaveLength(0);
    },
  );

  it.each(PAGES)("%s shows the same alert on a network failure", async (_name, page) => {
    meFailure = "network";
    render(page());
    expect((await screen.findByRole("alert")).textContent).toContain("Non riusciamo a verificare");
  });

  it.each(PAGES)("%s: Riprova asks again and then shows the page", async (_name, page) => {
    meFailure = "500";
    render(page());
    await screen.findByRole("button", { name: "Riprova" });
    meFailure = "none";
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await waitFor(() => expect(fileInputs().length).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(PAGES)("%s: a 401 is signed out, not an error", async (_name, page) => {
    meFailure = "401";
    render(page());
    // Signed out is settled when the sign-in link is there; only then is "no error notice" a real absence.
    const link = await screen.findByRole("link", { name: "Accedi" });
    expect(link.getAttribute("href")).toBe("/login");
    expect(screen.queryByText(/Non riusciamo a verificare/)).toBeNull();
  });
});
