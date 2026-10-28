// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

let role = "owner";
const paths: string[] = [];
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  paths.push(path);
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
