// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SP3 step 18, step 12 (V2): the console's enrolment is the shared EnrolFactor on the account paths. The secret lives in state only.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

const SECRET = "JBSWY3DPEHPK3PXP";
const QR =
  "data:image/svg+xml;utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E";
const FACTOR_ID = "11111111-1111-4111-8111-111111111111";
const FACTOR_2 = "22222222-2222-4222-8222-222222222222";
const START = "/api/auth/mfa/account/factors";
const verifyPath = (id: string) => `/api/auth/mfa/account/factors/${id}/verify`;

const calls: { path: string; method: string | undefined; body: unknown }[] = [];
let replies: Record<string, Reply[]> = {};
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, method: init?.method, body: init?.body });
  return Promise.resolve(replies[path]?.shift() ?? { ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));

import EnrolPage from "@/app/(platform)/console/login/attiva-codice/page";
import { ConsoleEnrol } from "@/components/console/console-enrol";

const enrolReply = (factorId: string, slot: string, secret = SECRET): Reply => ({
  ok: true,
  status: 201,
  data: { factorId, slot, qrImage: QR, secret },
});
const verifyOk: Reply = { ok: true, status: 200, data: { factor: {}, currentLevel: "aal2" } };
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const assign = vi.fn();

beforeEach(() => {
  calls.length = 0;
  replies = { [START]: [enrolReply(FACTOR_ID, "principale")] };
  apiJson.mockClear();
  assign.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "location", {
    value: { assign, replace: vi.fn(), pathname: "/login/attiva-codice", search: "" },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
  vi.restoreAllMocks();
});

const mount = (next: string | undefined = "/registro") =>
  render(createElement(ConsoleEnrol, { next }));
const ready = () => screen.findByAltText("Codice QR per l'app di autenticazione");
const type = (code: string) =>
  fireEvent.change(screen.getByLabelText("Codice di 6 cifre"), { target: { value: code } });
const attiva = () => screen.getByRole("button", { name: "Attiva" });

describe("ConsoleEnrol", () => {
  it("mounting posts {slot: 'principale'} to /api/auth/mfa/account/factors exactly once, also under StrictMode", async () => {
    render(createElement(StrictMode, null, createElement(ConsoleEnrol, { next: undefined })));
    await ready();
    expect(calls).toEqual([{ path: START, method: "POST", body: { slot: "principale" } }]);
  });

  it("shows the QR image and the setup key in groups of four", async () => {
    mount();
    const img = (await ready()) as HTMLImageElement;
    expect(img.src).toBe(QR);
    expect((screen.getByLabelText("Chiave di configurazione") as HTMLInputElement).value).toBe(
      "JBSW Y3DP EHPK 3PXP",
    );
  });

  it("posts the code to …/factors/<id>/verify", async () => {
    replies[verifyPath(FACTOR_ID)] = [verifyOk];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({
      path: verifyPath(FACTOR_ID),
      method: "POST",
      body: { code: "123456" },
    });
  });

  it("a wrong code is announced and the field cleared", async () => {
    replies[verifyPath(FACTOR_ID)] = [
      { ok: false, status: 422, error: { code: "mfa_code_invalid", message: "s" } },
    ];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    expect(
      await screen.findByText(
        "Codice non valido. Controlla che l'ora del telefono sia giusta e riprova.",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("Codice di 6 cifre") as HTMLInputElement).value).toBe("");
  });

  it("a 429 mfa_locked names the minutes", async () => {
    replies[verifyPath(FACTOR_ID)] = [
      {
        ok: false,
        status: 429,
        error: { code: "mfa_locked", message: "s", details: { retryAfterSeconds: 720 } },
      },
    ];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    expect(await screen.findByText("Troppi tentativi. Riprova tra 12 minuti.")).toBeTruthy();
  });

  it("a 409 mfa_slot_taken shows the message and «Riprova», which asks again", async () => {
    replies[START] = [
      { ok: false, status: 409, error: { code: "mfa_slot_taken", message: "Slot già usato." } },
      enrolReply(FACTOR_2, "principale"),
    ];
    mount();
    expect(await screen.findByText("Slot già usato.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await ready();
    expect(calls.filter((c) => c.path === START)).toHaveLength(2);
  });

  it("after the first factor offers a backup: «Aggiungi riserva» posts {slot: 'riserva'}", async () => {
    replies[START]!.push(enrolReply(FACTOR_2, "riserva", "KRSXG5CTMVRXEZLU"));
    replies[verifyPath(FACTOR_ID)] = [verifyOk];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    fireEvent.click(await screen.findByRole("button", { name: "Aggiungi riserva" }));
    await ready();
    expect(calls.at(-1)).toEqual({ path: START, method: "POST", body: { slot: "riserva" } });
  });

  it("«Più tardi» is a full document load to the safe next path", async () => {
    replies[verifyPath(FACTOR_ID)] = [verifyOk];
    mount("/avvisi");
    await ready();
    type("123456");
    fireEvent.click(attiva());
    fireEvent.click(await screen.findByRole("button", { name: "Più tardi" }));
    expect(assign).toHaveBeenCalledWith("/avvisi");
  });

  it("an unsafe next goes to /", async () => {
    replies[verifyPath(FACTOR_ID)] = [verifyOk];
    mount("https://evil.test/");
    await ready();
    type("123456");
    fireEvent.click(attiva());
    fireEvent.click(await screen.findByRole("button", { name: "Più tardi" }));
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("never calls /api/me/mfa*", async () => {
    replies[verifyPath(FACTOR_ID)] = [verifyOk];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    await screen.findByRole("button", { name: "Più tardi" });
    expect(calls.some((c) => c.path.startsWith("/api/me/"))).toBe(false);
  });

  it("keeps the key out of storage, the address and console output, and drops it on unmount", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m),
    );
    const { unmount } = mount();
    await ready();
    expect(document.body.innerHTML).toContain("JBSW Y3DP EHPK 3PXP");
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(window.location)).not.toContain(SECRET);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    act(() => unmount());
    expect(document.body.innerHTML).not.toContain("JBSW");
    expect(document.body.innerHTML).not.toContain(QR);
  });
});

describe("the page", () => {
  it("has one h1 and the venue wording for the heading and steps, and Esci", async () => {
    render(await EnrolPage({ searchParams: Promise.resolve({ next: "/registro" }) }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Attiva la verifica in due passaggi" }),
    ).toBeTruthy();
    expect(screen.getByText("Per gli account admin è obbligatoria.")).toBeTruthy();
    await ready();
    expect(screen.getByText("Installa sul telefono un'app di autenticazione.")).toBeTruthy();
    expect(screen.getByText("Inquadra il codice QR con l'app.")).toBeTruthy();
    expect(screen.getByText("Scrivi il codice di 6 cifre che compare nell'app.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Esci" })).toBeTruthy();
  });
});
