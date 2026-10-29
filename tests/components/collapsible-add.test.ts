// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { CollapsibleAdd, useCollapsibleAdd } from "@/components/collapsible-add";

// UX plan C1 (P2-1): the list comes first; the add form sits behind "Aggiungi …" when the list is not empty, and is open
// when the list is empty. The button focuses the first field, and a save closes the form again.

const ME = {
  user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role: "owner" },
  tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
};
const SUPPLIER = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Fornitore Demo Srl",
  vatNumber: null,
  paymentTermsDays: 30,
  isActive: true,
};
const INGREDIENT = {
  id: "d0000000-0000-4000-8000-000000000001",
  name: "Pomodoro (demo)",
  baseUnit: "kg",
  category: null,
  isStock: true,
  allergens: [],
  allergenStatus: "confirmed",
  allergensConfirmedAt: null,
  defaultShelfLifeDays: null,
  isActive: true,
};
const LOCATION = {
  id: "e0000000-0000-4000-8000-000000000001",
  name: "Cella (demo)",
  isActive: true,
};
const STAFF = {
  id: "f0000000-0000-4000-8000-000000000001",
  displayName: "Giulia",
  role: "waiter",
  loginMethod: "pin",
  active: true,
  lockedUntil: null,
};
const DEVICE = {
  id: "f1000000-0000-4000-8000-000000000001",
  label: "Telefono cucina",
  status: "attivo",
  enrolledAt: "2026-10-20T10:00:00Z",
  lastLoginAt: null,
  lockedAt: null,
};

let filled = true;
const ok = (data: unknown, status = 200) => Promise.resolve({ ok: true, status, data });
const apiJson = vi.fn((path: string, init?: { method?: string }) => {
  if (path === "/api/me") return ok(ME);
  if (init?.method === "POST")
    return ok({ display: "ABCD-EFGH", label: "x", expiresAt: "2026-10-30T10:00:00Z" }, 201);
  if (path.startsWith("/api/suppliers")) return ok({ suppliers: filled ? [SUPPLIER] : [] });
  if (path.startsWith("/api/ingredients")) return ok({ ingredients: filled ? [INGREDIENT] : [] });
  if (path.startsWith("/api/locations")) return ok({ locations: filled ? [LOCATION] : [] });
  if (path.startsWith("/api/users")) return ok({ staff: filled ? [STAFF] : [] });
  if (path.startsWith("/api/devices"))
    return ok({ devices: filled ? [DEVICE] : [], pendingCodes: [] });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: { method?: string }) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import IngredientsPage from "@/app/(owner)/anagrafiche/ingredienti/page";
import LocationsPage from "@/app/(owner)/anagrafiche/ubicazioni/page";
import SuppliersPage from "@/app/(owner)/anagrafiche/fornitori/page";
import StaffPage from "@/app/(owner)/personale/page";
import DevicesPage from "@/app/(owner)/dispositivi/page";

beforeEach(() => {
  resetMe();
  filled = true;
  apiJson.mockClear();
});
afterEach(cleanup);

describe("useCollapsibleAdd", () => {
  it("is closed while the list is loading, closed for a list with rows, open for an empty list", () => {
    expect(renderHook(() => useCollapsibleAdd(null)).result.current.open).toBe(false);
    expect(renderHook(() => useCollapsibleAdd(3)).result.current.open).toBe(false);
    expect(renderHook(() => useCollapsibleAdd(0)).result.current.open).toBe(true);
  });

  it("follows the user once they choose, whatever the list does after", () => {
    const { result, rerender } = renderHook(({ count }) => useCollapsibleAdd(count), {
      initialProps: { count: 0 as number | null },
    });
    act(() => result.current.hide());
    rerender({ count: 0 });
    expect(result.current.open).toBe(false);
    act(() => result.current.show());
    rerender({ count: 5 });
    expect(result.current.open).toBe(true);
  });
});

describe("CollapsibleAdd", () => {
  const props = { label: "Aggiungi cosa", onShow: vi.fn() };
  const field = () => createElement("input", { "aria-label": "Nome" });

  it("shows the button and not the children while closed", () => {
    render(createElement(CollapsibleAdd, { ...props, open: false }, field()));
    expect(
      screen.getByRole("button", { name: "Aggiungi cosa" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByLabelText("Nome")).toBeNull();
  });

  it("shows the children and not the button while open", () => {
    render(createElement(CollapsibleAdd, { ...props, open: true }, field()));
    expect(screen.queryByRole("button", { name: "Aggiungi cosa" })).toBeNull();
    expect(screen.getByLabelText("Nome")).toBeTruthy();
  });

  it("does not steal focus when it starts open", () => {
    render(createElement(CollapsibleAdd, { ...props, open: true }, field()));
    expect(document.activeElement).toBe(document.body);
  });
});

const SIMPLE_PAGES = [
  {
    name: "Fornitori",
    element: () => createElement(SuppliersPage),
    row: /Fornitore Demo Srl/,
    button: "Aggiungi fornitore",
    form: "Nuovo fornitore",
    note: "Fornitore aggiunto.",
  },
  {
    name: "Ingredienti",
    element: () => createElement(IngredientsPage),
    row: /Pomodoro/,
    button: "Aggiungi ingrediente",
    form: "Nuovo ingrediente",
    note: "Ingrediente aggiunto.",
  },
  {
    name: "Ubicazioni",
    element: () => createElement(LocationsPage),
    row: /Cella/,
    button: "Aggiungi ubicazione",
    form: "Nuova ubicazione",
    note: "Ubicazione aggiunta.",
  },
] as const;

describe.each(SIMPLE_PAGES)("$name", ({ element, row, button, form, note }) => {
  it("lists first and keeps the add form behind its button when there are rows", async () => {
    render(element());
    await screen.findByText(row);
    expect(screen.getByRole("button", { name: button })).toBeTruthy();
    expect(screen.queryByRole("form", { name: form })).toBeNull();
  });

  it("opens the form with the focus on Nome when the button is tapped", async () => {
    render(element());
    await screen.findByText(row);
    fireEvent.click(await screen.findByRole("button", { name: button }));
    const formEl = screen.getByRole("form", { name: form });
    expect(formEl).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Nome"));
    expect(screen.queryByRole("button", { name: button })).toBeNull();
  });

  it("shows the form open and no button when the list is empty", async () => {
    filled = false;
    render(element());
    expect(await screen.findByRole("form", { name: form })).toBeTruthy();
    expect(screen.queryByRole("button", { name: button })).toBeNull();
  });

  it("closes the form after a save and keeps the confirmation", async () => {
    render(element());
    await screen.findByText(row);
    fireEvent.click(await screen.findByRole("button", { name: button }));
    const formEl = screen.getByRole("form", { name: form });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Nome Demo" } });
    await act(async () => {
      fireEvent.submit(formEl);
    });
    expect((await screen.findByRole("status")).textContent).toBe(note);
    expect(screen.queryByRole("form", { name: form })).toBeNull();
    expect(screen.getByRole("button", { name: button })).toBeTruthy();
  });
});

describe("Personale", () => {
  it("keeps the add form behind 'Aggiungi persona' when there are people, and opens it on tap", async () => {
    render(createElement(StaffPage));
    await screen.findByText(/Giulia/);
    expect(screen.queryByLabelText("Nome")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi persona" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Nome/));
  });

  it("shows the form open for an empty list", async () => {
    filled = false;
    render(createElement(StaffPage));
    expect(await screen.findByLabelText(/^Nome/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aggiungi persona" })).toBeNull();
  });

  it("closes the form after a save", async () => {
    render(createElement(StaffPage));
    await screen.findByText(/Giulia/);
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi persona" }));
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Marco" } });
    const pins = document.querySelectorAll<HTMLInputElement>("input[type=password]");
    pins.forEach((pin) => fireEvent.change(pin, { target: { value: "2468" } }));
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/^Nome/).closest("form")!);
    });
    expect((await screen.findByRole("status")).textContent).toMatch(/Marco/);
    expect(screen.queryByLabelText(/^Nome/)).toBeNull();
  });
});

describe("Dispositivi", () => {
  it("keeps the code form behind 'Aggiungi dispositivo' when there are devices, and opens it on tap", async () => {
    render(createElement(DevicesPage));
    await screen.findByText(/Telefono cucina/);
    expect(screen.queryByRole("button", { name: "Crea codice" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi dispositivo" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Nome del dispositivo/));
  });

  it("shows the code form open for an empty list", async () => {
    filled = false;
    render(createElement(DevicesPage));
    expect(await screen.findByRole("button", { name: "Crea codice" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aggiungi dispositivo" })).toBeNull();
  });

  it("closes the form when the code is created and shows the code card", async () => {
    render(createElement(DevicesPage));
    await screen.findByText(/Telefono cucina/);
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi dispositivo" }));
    fireEvent.change(screen.getByLabelText(/^Nome del dispositivo/), {
      target: { value: "Tablet" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/^Nome del dispositivo/).closest("form")!);
    });
    expect(await screen.findByText(/ABCD-EFGH/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Crea codice" })).toBeNull();
  });
});
