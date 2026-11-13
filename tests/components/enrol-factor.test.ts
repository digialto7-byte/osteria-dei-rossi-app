// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// P2-1 B2: the enrolment component. It reads and writes only through /api/me/mfa/*; the secret lives in React state and is dropped on unmount.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

const SECRET = "JBSWY3DPEHPK3PXP";
const QR =
  "data:image/svg+xml;utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E";
const FACTOR_ID = "11111111-1111-4111-8111-111111111111";
const FACTOR_2 = "22222222-2222-4222-8222-222222222222";

const calls: { path: string; method: string | undefined; body: unknown }[] = [];
let replies: Record<string, Reply[]> = {};
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, method: init?.method, body: init?.body });
  const next = replies[path]?.shift();
  return Promise.resolve(next ?? { ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));

import { EnrolFactor } from "@/components/mfa/enrol-factor";

const enrolReply = (factorId: string, slot: string, secret = SECRET): Reply => ({
  ok: true,
  status: 201,
  data: { factorId, slot, qrImage: QR, secret },
});
const verifyOk: Reply = { ok: true, status: 200, data: { factor: {}, currentLevel: "aal2" } };

let onFinished: Mock<() => void>;
beforeEach(() => {
  calls.length = 0;
  replies = { "/api/me/mfa/factors": [enrolReply(FACTOR_ID, "principale")] };
  apiJson.mockClear();
  onFinished = vi.fn<() => void>();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

const mount = (props: Partial<Parameters<typeof EnrolFactor>[0]> = {}) =>
  render(
    createElement(EnrolFactor, { slot: "principale", offerBackup: true, onFinished, ...props }),
  );
const codeField = () => screen.getByLabelText("Codice di 6 cifre") as HTMLInputElement;
const type = (code: string) => fireEvent.change(codeField(), { target: { value: code } });
const attiva = () => screen.getByRole("button", { name: "Attiva" }) as HTMLButtonElement;
const ready = () => screen.findByAltText("Codice QR per l'app di autenticazione");

describe("EnrolFactor, the three steps", () => {
  it("starts the enrolment on mount with the slot only, and shows the steps once the reply is in", async () => {
    mount();
    expect(screen.getByText("Preparo il codice…")).toBeTruthy();
    await ready();
    expect(calls).toEqual([
      { path: "/api/me/mfa/factors", method: "POST", body: { slot: "principale" } },
    ]);
    expect(screen.getByText("Installa sul telefono un'app di autenticazione.")).toBeTruthy();
    expect(screen.getByText("Inquadra il codice QR con l'app.")).toBeTruthy();
    expect(screen.getByText("Scrivi il codice di 6 cifre che compare nell'app.")).toBeTruthy();
  });

  it("renders the reply's qrImage as an <img src> with the Italian alt text, never as markup", async () => {
    const { container } = mount();
    const img = (await ready()) as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe(QR);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows the key in groups of four, read-only, autocomplete off, with no copy button", async () => {
    mount();
    await ready();
    const key = screen.getByLabelText("Chiave di configurazione") as HTMLInputElement;
    expect(key.value).toBe("JBSW Y3DP EHPK 3PXP");
    expect(key.readOnly).toBe(true);
    expect(key.getAttribute("autocomplete")).toBe("off");
    expect(screen.queryByRole("button", { name: /copia|copy/i })).toBeNull();
  });

  it("the code field is numeric, one-time-code, six characters, and keeps only digits", async () => {
    mount();
    await ready();
    const field = codeField();
    expect(field.getAttribute("inputmode")).toBe("numeric");
    expect(field.getAttribute("autocomplete")).toBe("one-time-code");
    expect(field.maxLength).toBe(6);
    type("12a 34-56789");
    expect(field.value).toBe("123456");
  });

  it("Attiva is disabled until six digits are typed", async () => {
    mount();
    await ready();
    expect(attiva().disabled).toBe(true);
    type("12345");
    expect(attiva().disabled).toBe(true);
    type("123456");
    expect(attiva().disabled).toBe(false);
  });

  it("makes every button a 44 px target", async () => {
    mount({ onCancel: vi.fn() });
    await ready();
    for (const button of screen.getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("min-h-tap");
    }
  });

  it("under React strict mode the enrolment is requested once", async () => {
    render(
      createElement(
        StrictMode,
        null,
        createElement(EnrolFactor, { slot: "principale", offerBackup: true, onFinished }),
      ),
    );
    await ready();
    expect(calls.filter((c) => c.path === "/api/me/mfa/factors")).toHaveLength(1);
  });
});

describe("EnrolFactor, the code", () => {
  it("posts {code} only to the factor's verify route", async () => {
    replies[`/api/me/mfa/factors/${FACTOR_ID}/verify`] = [verifyOk];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({
      path: `/api/me/mfa/factors/${FACTOR_ID}/verify`,
      method: "POST",
      body: { code: "123456" },
    });
  });

  it("a wrong code: the message is announced, the field is cleared and focused", async () => {
    replies[`/api/me/mfa/factors/${FACTOR_ID}/verify`] = [
      { ok: false, status: 422, error: { code: "mfa_code_invalid", message: "server" } },
    ];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    const alert = await screen.findByText(
      "Codice non valido. Controlla che l'ora del telefono sia giusta e riprova.",
    );
    expect(alert.closest("[aria-live]")?.getAttribute("aria-live")).toBe("assertive");
    expect(codeField().value).toBe("");
    expect(document.activeElement).toBe(codeField());
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("a lock says how many minutes, from retryAfterSeconds", async () => {
    replies[`/api/me/mfa/factors/${FACTOR_ID}/verify`] = [
      {
        ok: false,
        status: 429,
        error: { code: "mfa_locked", message: "server", details: { retryAfterSeconds: 720 } },
      },
    ];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    expect(await screen.findByText("Troppi tentativi. Riprova tra 12 minuti.")).toBeTruthy();
  });

  it("success with offerBackup shows the backup prompt; Più tardi finishes without another request", async () => {
    replies[`/api/me/mfa/factors/${FACTOR_ID}/verify`] = [verifyOk];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    expect(await screen.findByText("Se perdi il telefono, entri con quello.")).toBeTruthy();
    expect(screen.queryByAltText("Codice QR per l'app di autenticazione")).toBeNull();
    expect(onFinished).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Più tardi" }));
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("Aggiungi riserva enrols the slot riserva and then finishes without offering a third device", async () => {
    replies[`/api/me/mfa/factors/${FACTOR_ID}/verify`] = [verifyOk];
    replies["/api/me/mfa/factors"]!.push(enrolReply(FACTOR_2, "riserva", "KRSXG5CTMVRXEZLU"));
    replies[`/api/me/mfa/factors/${FACTOR_2}/verify`] = [verifyOk];
    mount();
    await ready();
    type("123456");
    fireEvent.click(attiva());
    fireEvent.click(await screen.findByRole("button", { name: "Aggiungi riserva" }));
    await ready();
    expect(calls[2]).toEqual({
      path: "/api/me/mfa/factors",
      method: "POST",
      body: { slot: "riserva" },
    });
    expect((screen.getByLabelText("Chiave di configurazione") as HTMLInputElement).value).toBe(
      "KRSX G5CT MVRX EZLU",
    );
    type("654321");
    fireEvent.click(attiva());
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Se perdi il telefono, entri con quello.")).toBeNull();
  });

  it("success without offerBackup finishes at once (a backup being added, or the offer page)", async () => {
    replies[`/api/me/mfa/factors/${FACTOR_ID}/verify`] = [verifyOk];
    mount({ offerBackup: false });
    await ready();
    type("123456");
    fireEvent.click(attiva());
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
  });
});

describe("EnrolFactor, problems and leaving", () => {
  it("a refused enrolment shows the server's message and offers Riprova", async () => {
    replies["/api/me/mfa/factors"] = [
      {
        ok: false,
        status: 409,
        error: { code: "mfa_factor_limit", message: "Hai già due dispositivi di verifica." },
      },
      enrolReply(FACTOR_ID, "principale"),
    ];
    mount();
    expect(await screen.findByText("Hai già due dispositivi di verifica.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await ready();
    expect(calls.filter((c) => c.path === "/api/me/mfa/factors")).toHaveLength(2);
  });

  it("Annulla is shown only when onCancel is given, and calls it", async () => {
    const { unmount } = mount();
    await ready();
    expect(screen.queryByRole("button", { name: "Annulla" })).toBeNull();
    unmount();
    replies["/api/me/mfa/factors"] = [enrolReply(FACTOR_ID, "principale")];
    const onCancel = vi.fn();
    mount({ onCancel });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("the riserva slot gets the backup title", async () => {
    replies["/api/me/mfa/factors"] = [enrolReply(FACTOR_2, "riserva")];
    mount({ slot: "riserva", offerBackup: false });
    await ready();
    expect(
      screen.getByRole("heading", { name: "Aggiungi un dispositivo di riserva" }),
    ).toBeTruthy();
  });

  it("after unmount the secret is in no DOM node, localStorage, sessionStorage or URL", async () => {
    const { unmount } = mount();
    await ready();
    type("123456");
    unmount();
    const everywhere = [
      document.documentElement.outerHTML,
      JSON.stringify({ ...localStorage }),
      JSON.stringify({ ...sessionStorage }),
      window.location.href,
    ].join("\n");
    for (const needle of [SECRET, "JBSW Y3DP", "123456", QR])
      expect(everywhere).not.toContain(needle);
  });

  it("nothing is written to storage while it is mounted either", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mount();
    await ready();
    type("123456");
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    await act(async () => undefined);
  });
});
