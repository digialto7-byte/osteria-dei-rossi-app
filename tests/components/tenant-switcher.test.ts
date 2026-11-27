// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_VIEW, type SyncView } from "@/lib/sync/view";

// SP2 S10: the header switcher. Shown only when GET /api/me/tenants lists two or more venues (lead ruling: /api/me has no tenantCount).
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const row = (id: string, name: string, current = false) => ({ id, name, role: "owner", current });

let reply: unknown;
const apiJson = vi.fn((_path: string) => Promise.resolve(reply));
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
const switchTenant = vi.fn();
vi.mock("@/lib/tenancy/switch", () => ({
  switchTenant: (...args: unknown[]) => switchTenant(...args),
}));
let view: SyncView = EMPTY_VIEW;
vi.mock("@/pwa/use-outbox", () => ({ useSyncView: () => view }));
vi.mock("@/components/forget-user", () => ({ forgetUser: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { TenantSwitcher } = await import("@/components/nav/tenant-switcher");
const { LeaveGuardProvider, useLeaveGuard } = await import("@/components/nav/leave-guard");

const ok = (tenants: unknown[]) => ({ ok: true, status: 200, data: { tenants } });
beforeEach(() => {
  apiJson.mockClear();
  switchTenant.mockReset();
  switchTenant.mockResolvedValue({ ok: true });
  view = EMPTY_VIEW;
  reply = ok([row(A, "Locale Uno", true), row(B, "Locale Due")]);
});
afterEach(cleanup);

const mount = (tone: "band" | "page" = "page") => render(createElement(TenantSwitcher, { tone }));

describe("TenantSwitcher", () => {
  it("reads GET /api/me/tenants, never an offline-cached copy", async () => {
    mount();
    await screen.findByRole("button", { name: /Locale Uno/ });
    expect(apiJson).toHaveBeenCalledWith("/api/me/tenants");
  });

  it.each([
    ["one venue", [row(A, "Locale Uno", true)]],
    ["none", []],
  ])("is hidden with %s", async (_label, tenants) => {
    reply = ok(tenants);
    const { container } = mount();
    await waitFor(() => expect(apiJson).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is hidden when the read fails, and while it loads", async () => {
    reply = { ok: false, status: 500, error: { code: "x", message: "x" } };
    const { container } = mount();
    expect(container.textContent).toBe("");
    await act(async () => undefined);
    expect(container.textContent).toBe("");
  });

  it("is visible with two venues and its name holds the current venue", async () => {
    mount();
    const button = await screen.findByRole("button", { name: /Locale Uno/ });
    expect(button.getAttribute("aria-label") ?? button.textContent).toContain("Locale Uno");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.className).toContain("min-h-tap");
  });

  it("opens a list of the other venues only; Escape closes it and returns focus", async () => {
    reply = ok([row(A, "Locale Uno", true), row(B, "Locale Due"), row(C, "Locale Tre")]);
    mount();
    const button = await screen.findByRole("button", { name: /Locale Uno/ });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("button", { name: /Locale (Due|Tre)/ });
    expect(items).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Locale Uno$/ })).toBeNull();
    fireEvent.keyDown(items[0]!, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("a tap runs switchTenant with the id and no next (Home)", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Locale Uno/ }));
    fireEvent.click(screen.getByRole("button", { name: /Locale Due/ }));
    expect(switchTenant).toHaveBeenCalledWith(B, { next: "/" });
  });

  it("the leave guard runs before switchTenant", async () => {
    let held: (() => void) | null = null;
    function Guarded() {
      useLeaveGuard((go) => {
        held = go;
        return true;
      });
      return createElement(TenantSwitcher, { tone: "page" });
    }
    render(createElement(LeaveGuardProvider, null, createElement(Guarded)));
    fireEvent.click(await screen.findByRole("button", { name: /Locale Uno/ }));
    fireEvent.click(screen.getByRole("button", { name: /Locale Due/ }));
    expect(switchTenant).not.toHaveBeenCalled();
    held!();
    expect(switchTenant).toHaveBeenCalledWith(B, { next: "/" });
  });

  it("is busy while switching, and shows the pending line only when mine > 0", async () => {
    let finish!: (v: unknown) => void;
    switchTenant.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    view = { ...EMPTY_VIEW, ready: true, pending: 2, mine: 2, visible: true };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Locale Uno/ }));
    fireEvent.click(screen.getByRole("button", { name: /Locale Due/ }));
    const status = screen.getAllByRole("status").map((s) => s.textContent);
    expect(status.join(" ")).toContain("Cambio locale");
    expect(status.join(" ")).toContain("2 operazioni in attesa restano su questo telefono");
    await act(async () => finish({ ok: false, code: "forbidden" }));
  });

  it("no pending line when nothing is waiting", async () => {
    switchTenant.mockReturnValue(new Promise(() => undefined));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Locale Uno/ }));
    fireEvent.click(screen.getByRole("button", { name: /Locale Due/ }));
    expect(screen.queryByText(/in attesa restan/)).toBeNull();
  });

  it.each([
    ["offline", "Serve la connessione per cambiare locale."],
    ["tenant_switch_too_soon", "Attendi qualche secondo e riprova."],
    ["tenant_not_found", "Non è stato possibile cambiare locale. Riprova."],
  ])("the code %s shows its message", async (code, message) => {
    switchTenant.mockResolvedValue({ ok: false, code });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Locale Uno/ }));
    fireEvent.click(screen.getByRole("button", { name: /Locale Due/ }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("a failed switch keeps focus on the venue button that was pressed, and the list stays", async () => {
    switchTenant.mockResolvedValue({ ok: false, code: "tenant_switch_too_soon" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Locale Uno/ }));
    const item = screen.getByRole("button", { name: /Locale Due/ });
    item.focus();
    fireEvent.click(item);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /Locale Due/ })).toBe(item);
    expect(document.activeElement).toBe(item);
  });

  it("warns about waiting operations in the open list before the tap, when mine > 0", async () => {
    view = { ...EMPTY_VIEW, ready: true, pending: 1, mine: 1, visible: true };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Locale Uno/ }));
    expect(screen.getByText(/1 operazione in attesa resta su questo telefono/)).toBeTruthy();
  });

  it("the band tone uses the band ink and its focus ring", async () => {
    mount("band");
    const button = await screen.findByRole("button", { name: /Locale Uno/ });
    expect(button.className).toContain("text-band-ink");
    expect(button.className).toContain("focus-visible:outline-band-ink");
  });
});
