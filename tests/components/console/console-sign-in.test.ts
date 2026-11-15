// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SP3 step 18, step 10: the console sign-in. Public route POST /api/platform/auth/password, no next, no PIN, no venue.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

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
import { ConsoleSignIn } from "@/components/console/console-sign-in";

const SIGN_IN = "/api/platform/auth/password";
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const assign = vi.fn();
const NAME = "demo-staff";
const PASSWORD = "una frase lunga di prova";

beforeEach(() => {
  calls.length = 0;
  replies = {};
  apiJson.mockClear();
  replace.mockClear();
  assign.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "location", {
    value: { assign, pathname: "/login", search: "" },
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
