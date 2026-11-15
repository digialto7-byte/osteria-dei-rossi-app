// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SP3 step 18, step 10: the console sign-in. Public route POST /api/platform/auth/password, no next, no PIN, no venue.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

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
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import LoginPage from "@/app/(platform)/console/login/page";
import { ConsoleChallenge } from "@/components/console/console-challenge";
import { ConsoleSignIn } from "@/components/console/console-sign-in";
import CodePage from "@/app/(platform)/console/login/codice/page";

const SIGN_IN = "/api/platform/auth/password";
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const assign = vi.fn();
const locationReplace = vi.fn();
const NAME = "demo-staff";
const PASSWORD = "una frase lunga di prova";

beforeEach(() => {
  calls.length = 0;
  replies = {};
  apiJson.mockClear();
  replace.mockClear();
  assign.mockClear();
  locationReplace.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "location", {
    value: { assign, replace: locationReplace, pathname: "/login", search: "" },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
});

const mount = (notice: "link" | "session" | null = null) =>
  render(createElement(ConsoleSignIn, { notice }));
const submit = () => screen.getByRole("button", { name: "Accedi con la password" });
function fill() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: NAME } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
  // submit the form itself: the sample name is not an address, so a click would stop at the browser's own check
  fireEvent.submit(submit().closest("form")!);
}

describe("the console sign-in", () => {
  it("shows one h1 «Console», the intro, Email, Password, «Mostra» and the primary «Accedi con la password»", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Console" })).toBeTruthy();
    expect(screen.getByText("Accesso riservato a DigiAlto.")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mostra" })).toBeTruthy();
    expect(submit().getAttribute("type")).toBe("submit");
  });

  it("posts exactly {email, password}, with no next", async () => {
    replies[SIGN_IN] = [{ ok: true, status: 200, data: { redirect: "/login/codice" } }];
    mount();
    fill();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      path: SIGN_IN,
      method: "POST",
      body: { email: NAME, password: PASSWORD },
    });
  });

  it("a successful sign-in clears a stale switch key, so a new session can switch again", async () => {
    sessionStorage.setItem("costi.console.switching", "1");
    replies[SIGN_IN] = [{ ok: true, status: 200, data: { redirect: "/login/codice" } }];
    mount();
    fill();
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(sessionStorage.getItem("costi.console.switching")).toBeNull();
  });

  it("a /login/codice redirect uses the router", async () => {
    replies[SIGN_IN] = [{ ok: true, status: 200, data: { redirect: "/login/codice" } }];
    mount();
    fill();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login/codice"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("a /login/attiva-codice redirect is a full document load, never a router move", async () => {
    replies[SIGN_IN] = [{ ok: true, status: 200, data: { redirect: "/login/attiva-codice" } }];
    mount();
    fill();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login/attiva-codice"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("403 not_console_account says the account has no access", async () => {
    replies[SIGN_IN] = [
      { ok: false, status: 403, error: { code: "not_console_account", message: "server" } },
    ];
    mount();
    fill();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Questo account non ha accesso alla console.",
    );
  });

  it.each([
    [401, "login_invalid", "Credenziali non corrette."],
    [429, "rate_limited", "Troppi tentativi, riprova tra poco."],
  ])("%s shows the server's message and clears the password", async (status, code, message) => {
    replies[SIGN_IN] = [{ ok: false, status, error: { code, message } }];
    mount();
    fill();
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it.each([
    ["a 502", 502, "upstream_error"],
    ["a network failure", 0, "network"],
  ])("%s says the console is not answering", async (_n, status, code) => {
    replies[SIGN_IN] = [{ ok: false, status, error: { code, message: "server" } }];
    mount();
    fill();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La console non risponde. Riprova tra poco.",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("errore=sessione shows the session line", () => {
    mount("session");
    expect(screen.getByText("La sessione è scaduta dopo 30 giorni: accedi di nuovo.")).toBeTruthy();
  });

  it("offers no PIN, «Chi sei?», device link, link by e-mail or «Password dimenticata?»", () => {
    mount();
    const text = document.body.textContent ?? "";
    for (const word of [
      "PIN",
      "Chi sei?",
      "Password dimenticata",
      "Inviami il link",
      "dispositivo",
    ]) {
      expect(text, word).not.toContain(word);
    }
    expect(document.querySelector('a[href*="dispositivo"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("@");
  });

  it("keeps the submit disabled until the page is hydrated", () => {
    const html = renderToString(createElement(ConsoleSignIn, { notice: null }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Accedi con la password/);
  });

  it("writes nothing to storage or the address, and shows the password as text only after «Mostra»", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    replies[SIGN_IN] = [{ ok: true, status: 200, data: { redirect: "/login/codice" } }];
    mount();
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Mostra" }));
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("text");
    fill();
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(window.location)).not.toContain(PASSWORD);
    setItem.mockRestore();
  });

  it("makes every button a 44 px target", () => {
    mount();
    for (const button of screen.getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("min-h-tap");
    }
  });
});

describe("the page", () => {
  it("passes ?errore=sessione to the form", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ errore: "sessione" }) }));
    expect(screen.getByText("La sessione è scaduta dopo 30 giorni: accedi di nuovo.")).toBeTruthy();
  });
});

describe("code page", () => {
  const ACCOUNT = "/api/auth/mfa/account";
  const P = "11111111-1111-4111-8111-111111111111";
  const R = "22222222-2222-4222-8222-222222222222";
  const status = (over: Record<string, unknown> = {}): Reply => ({
    ok: true,
    status: 200,
    data: {
      factors: [{ id: P, slot: "principale", status: "verified" }],
      currentLevel: "aal1",
      canAddFactor: true,
      lockedUntil: null,
      ...over,
    },
  });
  const fail = (status: number, code: string, message = "server"): Reply => ({
    ok: false,
    status,
    error: { code, message },
  });
  const paths = () => calls.map((c) => c.path);
  const field = async () => (await screen.findByLabelText("Codice di 6 cifre")) as HTMLInputElement;
  const verify = () => screen.getByRole("button", { name: "Verifica" }) as HTMLButtonElement;
  const enter = async (code: string) => {
    fireEvent.change(await field(), { target: { value: code } });
    fireEvent.click(verify());
  };
  const mountCode = (next?: string) => render(createElement(ConsoleChallenge, { next }));

  beforeEach(() => {
    replies[ACCOUNT] = [status(), { ok: true, status: 200, data: { redirect: "/" } }];
  });

  it("reads GET /api/auth/mfa/account and never /api/me/mfa", async () => {
    mountCode("/registro");
    await field();
    expect(calls[0]).toEqual({ path: ACCOUNT, method: undefined, body: undefined });
    await enter("123456");
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(paths().some((p) => p.startsWith("/api/me/"))).toBe(false);
    expect(paths()).not.toContain("/api/auth/mfa/challenge");
  });

  it("posts {factorId, code, next} to POST /api/auth/mfa/account and follows the redirect", async () => {
    replies[ACCOUNT]![1] = { ok: true, status: 200, data: { redirect: "/registro" } };
    mountCode("/registro");
    await enter("123456");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/registro"));
    expect(calls[1]).toEqual({
      path: ACCOUNT,
      method: "POST",
      body: { factorId: P, code: "123456", next: "/registro" },
    });
  });

  it("a correct code clears a stale switch key", async () => {
    sessionStorage.setItem("costi.console.switching", "1");
    mountCode("/registro");
    await enter("123456");
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(sessionStorage.getItem("costi.console.switching")).toBeNull();
  });

  it("an unsafe next is sent as /", async () => {
    mountCode("https://evil.test/");
    await enter("123456");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1]!.body as { next: string }).next).toBe("/");
  });

  it("shows «Per continuare inserisci il codice.» only when next is present", async () => {
    const { unmount } = mountCode("/registro");
    await field();
    expect(screen.getByRole("status").textContent).toBe("Per continuare inserisci il codice.");
    unmount();
    replies[ACCOUNT] = [status()];
    mountCode(undefined);
    await field();
    expect(screen.queryByText("Per continuare inserisci il codice.")).toBeNull();
  });

  it("aal2 goes straight to next, with no form", async () => {
    replies[ACCOUNT] = [status({ currentLevel: "aal2" })];
    mountCode("/avvisi");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/avvisi"));
    expect(screen.queryByLabelText("Codice di 6 cifre")).toBeNull();
  });

  it("no verified factor loads the enrolment page as a full document, with the way back", async () => {
    replies[ACCOUNT] = [status({ factors: [] })];
    mountCode("/registro?dal=2026-11-01");
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "/login/attiva-codice?next=%2Fregistro%3Fdal%3D2026-11-01",
      ),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("a wrong code is announced and the field cleared", async () => {
    replies[ACCOUNT]![1] = fail(422, "mfa_code_invalid");
    mountCode();
    await enter("123456");
    expect(
      await screen.findByText(
        "Codice non valido. Controlla che l'ora del telefono sia giusta e riprova.",
      ),
    ).toBeTruthy();
    expect((await field()).value).toBe("");
  });

  it("an expired code", async () => {
    replies[ACCOUNT]![1] = fail(422, "mfa_challenge_expired");
    mountCode();
    await enter("123456");
    expect(await screen.findByText("Il codice è scaduto. Riprova.")).toBeTruthy();
  });

  it("a lock names the minutes and disables the field", async () => {
    replies[ACCOUNT]![1] = {
      ok: false,
      status: 429,
      error: { code: "mfa_locked", message: "s", details: { retryAfterSeconds: 720 } },
    };
    mountCode();
    await enter("123456");
    expect(await screen.findByText("Troppi tentativi. Riprova tra 12 minuti.")).toBeTruthy();
    expect((await field()).disabled).toBe(true);
  });

  it("a rate limit shows the server's message and keeps the field usable", async () => {
    replies[ACCOUNT]![1] = fail(429, "rate_limited", "Troppe richieste, riprova tra poco.");
    mountCode();
    await enter("123456");
    expect(await screen.findByText("Troppe richieste, riprova tra poco.")).toBeTruthy();
    expect((await field()).disabled).toBe(false);
  });

  it("the backup switch changes the factor sent", async () => {
    replies[ACCOUNT]![0] = status({
      factors: [
        { id: R, slot: "riserva", status: "verified" },
        { id: P, slot: "principale", status: "verified" },
      ],
    });
    mountCode();
    await field();
    fireEvent.click(screen.getByRole("button", { name: "Usa il dispositivo di riserva" }));
    await enter("111111");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1]!.body as { factorId: string }).factorId).toBe(R);
  });

  it("403 forbidden says the account has no access to the console, and offers Esci", async () => {
    replies[ACCOUNT] = [fail(403, "forbidden")];
    mountCode();
    expect(await screen.findByText("Questo account non ha accesso alla console.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Esci" })).toBeTruthy();
  });

  it("a console that is down says so", async () => {
    replies[ACCOUNT] = [fail(0, "network")];
    mountCode();
    expect(await screen.findByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
  });

  it("Esci posts /api/platform/logout, not /api/auth/logout, and goes to /login", async () => {
    mountCode();
    await field();
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/login"));
    expect(paths()).toContain("/api/platform/logout");
    expect(paths()).not.toContain("/api/auth/logout");
  });

  it("a failing logout shows «La console non risponde…» and does not leave", async () => {
    replies["/api/platform/logout"] = [fail(0, "network")];
    mountCode();
    await field();
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    expect(await screen.findByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
    expect(locationReplace).not.toHaveBeenCalled();
  });

  it("never writes the code to storage or the address, and every button is a 44 px target", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mountCode();
    await enter("123456");
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    for (const button of screen.getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("min-h-tap");
    }
    setItem.mockRestore();
  });

  it("the page has one h1 and passes next to the form", async () => {
    render(await CodePage({ searchParams: Promise.resolve({ next: "/avvisi" }) }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Codice di verifica" })).toBeTruthy();
    await enter("123456");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1]!.body as { next: string }).next).toBe("/avvisi");
  });
});
