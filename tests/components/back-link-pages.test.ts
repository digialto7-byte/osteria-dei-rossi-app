// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

// UX plan B5: the pages that had no back link get one, and it is the first link on the page.
const SUPPLIER_ID = "c0000000-0000-4000-8000-000000000001";
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
  if (path.startsWith("/api/suppliers/"))
    return ok({
      supplier: {
        id: SUPPLIER_ID,
        name: "Fornitore Demo Srl",
        vatNumber: null,
        paymentTermsDays: 30,
        isActive: true,
      },
    });
  if (path.startsWith("/api/supplier-items")) return ok({ items: [] });
  if (path.startsWith("/api/ingredients")) return ok({ ingredients: [] });
  if (path.startsWith("/api/devices")) return ok({ devices: [], pendingCodes: [] });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import SupplierPage from "@/app/(owner)/anagrafiche/fornitori/[id]/page";
import DevicesPage from "@/app/(owner)/dispositivi/page";

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
});
afterEach(cleanup);

describe("back links on the pages that had none", () => {
  it("the supplier's page starts with a link to the suppliers list", async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(SupplierPage, { params: Promise.resolve({ id: SUPPLIER_ID }) }),
        ),
      );
    });
    await screen.findByRole("heading", { name: "Fornitore Demo Srl" });
    const first = view.container.querySelector("a")!;
    expect(first.getAttribute("href")).toBe("/anagrafiche/fornitori");
    expect(first.textContent).toContain("Tutti i fornitori");
  });

  it("the devices page starts with a link to the staff page", async () => {
    const { container } = render(createElement(DevicesPage));
    await screen.findByRole("heading", { name: /Dispositivi/ });
    const first = container.querySelector("a")!;
    expect(first.getAttribute("href")).toBe("/personale");
    expect(first.textContent).toContain("Torna al personale");
  });
});
