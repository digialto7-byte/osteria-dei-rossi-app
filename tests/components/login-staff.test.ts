// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STAFF = [
  { id: "11111111-1111-4111-8111-111111111111", displayName: "Cameriere Demo", role: "waiter" },
];

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
let deviceReply: Reply;
let pinReply: Reply;
const apiJson = vi.fn((path: string): Promise<Reply> => {
  if (path === "/api/auth/device") return Promise.resolve(deviceReply);
  if (path === "/api/auth/pin") return Promise.resolve(pinReply);
  return Promise.resolve({ ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string) => apiJson(path),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/forget-user", () => ({ forgetUser: vi.fn() }));

import { LoginScreen } from "@/app/(public)/login/login-screen";

const enrolled = (): Reply => ({
  ok: true,
  status: 200,
  data: { enrolled: true, label: "Telefono sala (demo)", locked: false, staff: STAFF },
});

beforeEach(() => {
  apiJson.mockClear();
  deviceReply = enrolled();
});
afterEach(cleanup);

const screenProps = { next: undefined, notice: null, justEnabled: false } as const;

describe("LoginScreen on an enrolled device", () => {
  it("opens on Chi sei? and shows no Accedi heading and no password form", async () => {
    render(createElement(LoginScreen, { ...screenProps, hasDevice: true }));
    expect(await screen.findByRole("heading", { name: "Chi sei?" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Accedi" })).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("offers the owner's form behind a disclosure with aria-expanded", async () => {
    render(createElement(LoginScreen, { ...screenProps, hasDevice: true }));
    await screen.findByRole("heading", { name: "Chi sei?" });
    const toggle = screen.getByRole("button", { name: "Sei il titolare? Accedi con email" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("owner-login");
    expect(document.getElementById("owner-login")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById("owner-login")!;
    expect(panel.querySelector("h2")?.textContent).toBe("Accesso titolare");
    expect(panel.querySelector("h1")).toBeNull();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("owner-login")).toBeNull();
  });

  it("falls back to the password view when the device is not enrolled (stale cookie)", async () => {
    deviceReply = { ok: true, status: 200, data: { enrolled: false } };
    render(createElement(LoginScreen, { ...screenProps, hasDevice: true }));
    expect(await screen.findByRole("heading", { name: "Accedi" })).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sei il titolare? Accedi con email" })).toBeNull();
  });

  async function submitPinWith(code: string) {
    pinReply = { ok: false, status: 401, error: { code, message: "x" } };
    render(createElement(LoginScreen, { ...screenProps, hasDevice: true }));
    fireEvent.click(await screen.findByRole("button", { name: /Cameriere Demo/ }));
    fireEvent.change(await screen.findByLabelText("PIN"), { target: { value: "4827" } });
    fireEvent.click(screen.getByRole("button", { name: "Entra" }));
    await screen.findByRole("heading", { name: "Accedi" });
  }

  it("a PIN answered with device_revoked falls back to the password view with the notice", async () => {
    await submitPinWith("device_revoked");
    const notes = screen.getAllByRole("status");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe(
      "Questo dispositivo non è più abilitato. Chiedi al titolare di abilitarlo di nuovo.",
    );
  });

  it("a PIN answered with device_unknown gives the password view and no notice", async () => {
    await submitPinWith("device_unknown");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a revoked device sees one status line in the password view, in Italian", async () => {
    deviceReply = { ok: true, status: 200, data: { enrolled: false, revoked: true } };
    render(createElement(LoginScreen, { ...screenProps, hasDevice: true }));
    expect(await screen.findByRole("heading", { name: "Accedi" })).toBeTruthy();
    const note = await screen.findByRole("status");
    expect(note.textContent).toBe(
      "Questo dispositivo non è più abilitato. Chiedi al titolare di abilitarlo di nuovo.",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("an unknown or forged cookie (enrolled:false only) shows no notice", async () => {
    deviceReply = { ok: true, status: 200, data: { enrolled: false } };
    render(createElement(LoginScreen, { ...screenProps, hasDevice: true }));
    await screen.findByRole("heading", { name: "Accedi" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/non è più abilitato/)).toBeNull();
  });

  it("no device cookie at all shows no notice and asks nothing of the API", async () => {
    render(createElement(LoginScreen, { ...screenProps, hasDevice: false }));
    expect(screen.getByRole("heading", { name: "Accedi" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("?abilitato=1 names the enabled phone in a status note", async () => {
    render(createElement(LoginScreen, { ...screenProps, hasDevice: true, justEnabled: true }));
    await screen.findByRole("heading", { name: "Chi sei?" });
    expect((await screen.findByRole("status")).textContent).toBe(
      "Telefono abilitato: Telefono sala (demo).",
    );
  });

  it("shows no such note without ?abilitato=1", async () => {
    render(createElement(LoginScreen, { ...screenProps, hasDevice: true }));
    await screen.findByRole("heading", { name: "Chi sei?" });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("LoginScreen without a device", () => {
  it("shows the password view and never asks the device route", async () => {
    render(createElement(LoginScreen, { ...screenProps, hasDevice: false }));
    expect(screen.getByRole("heading", { name: "Accedi" })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeTruthy());
    expect(apiJson).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Abilita questo telefono per il personale" }),
    ).toBeTruthy();
  });

  it("shows the notices", () => {
    render(createElement(LoginScreen, { ...screenProps, hasDevice: false, notice: "session" }));
    expect(screen.getByText("La sessione è scaduta dopo 30 giorni: accedi di nuovo.")).toBeTruthy();
  });
});
