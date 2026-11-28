// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SP2 S10 (docs/plans/2026-11-26-sp02-memberships.md §8): the venue chooser /login/scegli-locale. It reads GET /api/me/tenants and
// switches through `switchTenant`; it never re-implements the switch.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const row = (id: string, name: string, role: string, current = false) => ({
  id,
  name,
  role,
  current,
});

let reply: unknown;
const apiJson = vi.fn((_path: string) => Promise.resolve(reply));
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
const switchTenant = vi.fn();
vi.mock("@/lib/tenancy/switch", () => ({
  switchTenant: (...args: unknown[]) => switchTenant(...args),
}));
vi.mock("@/pwa/use-outbox", () => ({ useSyncView: () => ({ mine: 0 }) }));
vi.mock("@/components/forget-user", () => ({ forgetUser: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { VenuePicker } = await import("@/app/(public)/login/scegli-locale/venue-picker");

const ok = (tenants: unknown[]) => ({ ok: true, status: 200, data: { tenants } });
beforeEach(() => {
  apiJson.mockClear();
  switchTenant.mockReset();
  switchTenant.mockResolvedValue({ ok: true });
  reply = ok([row(A, "Locale Uno", "owner"), row(B, "Locale Due", "waiter")]);
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(cleanup);

const mount = (next?: string) => render(createElement(VenuePicker, { next }));

describe("VenuePicker", () => {
  it("reads GET /api/me/tenants and shows one button per venue with its role label", async () => {
    mount();
    expect(apiJson).toHaveBeenCalledWith("/api/me/tenants");
    const uno = await screen.findByRole("button", { name: /Locale Uno/ });
    expect(uno.textContent).toContain("Titolare");
    expect(screen.getByRole("button", { name: /Locale Due/ }).textContent).toContain("Cameriere");
    expect(screen.getAllByRole("button", { name: /Locale/ })).toHaveLength(2);
  });

  it("marks the current venue", async () => {
    reply = ok([row(A, "Locale Uno", "owner", true), row(B, "Locale Due", "waiter")]);
    mount();
    const uno = await screen.findByRole("button", { name: /Locale Uno/ });
    expect(uno.getAttribute("aria-current")).toBe("true");
    expect(uno.textContent).toContain("Locale attuale");
    expect(
      screen.getByRole("button", { name: /Locale Due/ }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("a tap calls switchTenant with the id and the page's next, unchanged", async () => {
    mount("/fatture?x=1");
    fireEvent.click(await screen.findByRole("button", { name: /Locale Due/ }));
    expect(switchTenant).toHaveBeenCalledWith(B, { next: "/fatture?x=1" });
  });

  it("is busy while it switches: no second tap, a status line", async () => {
    let finish!: (v: unknown) => void;
    switchTenant.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Locale Due/ }));
    expect(screen.getByRole("status").textContent).toContain("Cambio locale");
    fireEvent.click(screen.getByRole("button", { name: /Locale Uno/ }));
    expect(switchTenant).toHaveBeenCalledTimes(1);
    finish({ ok: false, code: "forbidden" });
    await waitFor(() => expect(screen.queryByText(/Cambio locale/)).toBeNull());
  });

  it.each([
    ["offline", "Serve la connessione per cambiare locale."],
    ["tenant_switch_too_soon", "Attendi qualche secondo e riprova."],
    ["tenant_not_found", "Non è stato possibile cambiare locale. Riprova."],
    ["tenant_switch_failed", "Non è stato possibile cambiare locale. Riprova."],
  ])("the code %s shows its message", async (code, message) => {
    switchTenant.mockResolvedValue({ ok: false, code });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Locale Due/ }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("an empty list shows home.noAccess", async () => {
    reply = ok([]);
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Il tuo account non è abilitato per nessun locale.",
    );
    expect(screen.queryByRole("button", { name: /Locale/ })).toBeNull();
  });

  it("a failed read shows an error with Riprova, which asks again", async () => {
    reply = { ok: false, status: 500, error: { code: "x", message: "x" } };
    mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    reply = ok([row(A, "Locale Uno", "owner")]);
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(await screen.findByRole("button", { name: /Locale Uno/ })).toBeTruthy();
    expect(apiJson).toHaveBeenCalledTimes(2);
  });

  it("offline: says a connection is needed", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    reply = { ok: false, status: 0, error: { code: "network_error", message: "x" } };
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("Serve la connessione");
  });

  it("a signed-out visitor (401) gets a link to the sign-in, not a retry", async () => {
    reply = { ok: false, status: 401, error: { code: "unauthenticated", message: "x" } };
    mount();
    const link = await screen.findByRole("link", { name: "Accedi" });
    expect(link.getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
  });

  it("has Esci below the list", async () => {
    mount();
    await screen.findByRole("button", { name: /Locale Uno/ });
    expect(screen.getByRole("button", { name: "Esci" })).toBeTruthy();
  });

  it("targets are 44 px and full width", async () => {
    mount();
    const uno = await screen.findByRole("button", { name: /Locale Uno/ });
    expect(uno.className).toContain("min-h-tap");
    expect(uno.className).toContain("w-full");
  });
});

// SP3 step 19 (docs/plans/2026-11-15-sp3-console.md §3.7): «Entra nel locale» opens this chooser with ?locale=<id>. The venue is listed first and marked; nothing
// switches on load (a GET never switches a tenant), and an id that is not a lowercase uuid, or not one of the login's venues, is ignored.
describe("VenuePicker with a highlighted venue (?locale=)", () => {
  const mountWith = (highlight: string | undefined) =>
    render(createElement(VenuePicker, { next: undefined, highlight }));
  const names = () => screen.getAllByRole("button", { name: /Locale/ }).map((b) => b.textContent);

  it("lists the highlighted venue first and marks it, and never switches on load", async () => {
    mountWith(B);
    const due = await screen.findByRole("button", { name: /Locale Due/ });
    expect(names()[0]).toContain("Locale Due");
    expect(due.textContent).toContain("Aperto dalla console");
    expect(screen.getByRole("button", { name: /Locale Uno/ }).textContent).not.toContain(
      "Aperto dalla console",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(switchTenant).not.toHaveBeenCalled();
  });

  it("a tap on it still switches through switchTenant, like any venue", async () => {
    mountWith(B);
    fireEvent.click(await screen.findByRole("button", { name: /Locale Due/ }));
    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith(B, { next: undefined }));
  });

  it("an id that is not one of the login's venues changes nothing", async () => {
    mountWith("33333333-3333-4333-8333-333333333333");
    await screen.findByRole("button", { name: /Locale Uno/ });
    expect(names()[0]).toContain("Locale Uno");
    expect(screen.queryByText(/Aperto dalla console/)).toBeNull();
  });
});

describe("the chooser page reads ?locale= only as a lowercase uuid", async () => {
  const { highlightOf } = await import("@/app/(public)/login/scegli-locale/highlight");
  it.each([
    [B, B],
    ["A0000000-0000-4000-8000-00000000000A", undefined],
    ["a0000000-0000-4000-8000-00000000000a", "a0000000-0000-4000-8000-00000000000a"],
    ["nope", undefined],
    [undefined, undefined],
    [[B, A], undefined],
  ])("%s -> %s", (value, expected) => {
    expect(highlightOf(value as string | string[] | undefined)).toBe(expected);
  });
});

// Review of PR 4: the tab «Entra nel locale» opens is usually signed out on the app host, and the platform admin's list needs the code first. Both ways out of
// the chooser come back to it with ?locale= kept, so the venue is still highlighted after the sign-in and the code.
describe("VenuePicker: the way to the sign-in and the code keeps the highlight", () => {
  const SELF = `/login/scegli-locale?locale=${B}`;
  const mountSelf = () =>
    render(createElement(VenuePicker, { next: undefined, highlight: B, self: SELF }));

  it("signed out: «Accedi» goes to /login with next = this page", async () => {
    reply = { ok: false, status: 401, error: { code: "unauthenticated", message: "x" } };
    mountSelf();
    const link = await screen.findByRole("link", { name: "Accedi" });
    expect(link.getAttribute("href")).toBe(`/login?next=${encodeURIComponent(SELF)}`);
  });

  it("the list needs the code (403 mfa_required): a link to the code page with next = this page, not an error", async () => {
    reply = { ok: false, status: 403, error: { code: "mfa_required", message: "x" } };
    mountSelf();
    const link = await screen.findByRole("link", { name: "Inserisci il codice" });
    expect(link.getAttribute("href")).toBe(`/login/codice?next=${encodeURIComponent(SELF)}`);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
