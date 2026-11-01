// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const calls: { path: string; init: { method?: string; body?: unknown } | undefined }[] = [];
let replies: Record<string, Reply> = {};
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, init });
  return Promise.resolve(replies[path] ?? { ok: true, status: 200, data: {} });
});
const replace = vi.fn();
const forgetUser = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/forget-user", () => ({ forgetUser: () => forgetUser() }));

import { PasswordForm } from "@/app/(public)/login/password-form";

const EMAIL = "titolare.demo@example.test";
const PASSWORD = "una frase lunga per il locale";

beforeEach(() => {
  calls.length = 0;
  replies = {};
  apiJson.mockClear();
  replace.mockClear();
  forgetUser.mockClear();
});
afterEach(cleanup);

const typeCredentials = () => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: EMAIL } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
};

describe("PasswordForm, the password path", () => {
  it("labels its fields for password managers", () => {
    render(createElement(PasswordForm, { next: undefined }));
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText("Email").getAttribute("name")).toBe("email");
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("current-password");
    expect(screen.getByRole("button", { name: "Accedi con la password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inviami il link" })).toBeTruthy();
  });

  it("posts the credentials once, forgets the cached user and goes where the server says", async () => {
    replies["/api/auth/password"] = { ok: true, status: 200, data: { redirect: "/tavoli" } };
    render(createElement(PasswordForm, { next: "/fatture" }));
    typeCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Accedi con la password" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/tavoli"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/auth/password");
    expect(calls[0]!.init).toMatchObject({
      method: "POST",
      body: { email: EMAIL, password: PASSWORD, next: "/fatture" },
    });
    expect(forgetUser).toHaveBeenCalledTimes(1);
  });

  it("a 401 shows the server's message and clears the password", async () => {
    replies["/api/auth/password"] = {
      ok: false,
      status: 401,
      error: { code: "login_invalid", message: "Email o password non corretti." },
    };
    render(createElement(PasswordForm, { next: undefined }));
    typeCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Accedi con la password" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Email o password non corretti.");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(EMAIL);
    expect(replace).not.toHaveBeenCalled();
    expect(forgetUser).not.toHaveBeenCalled();
  });

  it("Mostra flips the field type and aria-pressed", () => {
    render(createElement(PasswordForm, { next: undefined }));
    const toggle = screen.getByRole("button", { name: "Mostra" });
    const field = screen.getByLabelText("Password");
    expect(field.getAttribute("type")).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(field.id);
    fireEvent.click(toggle);
    expect(field.getAttribute("type")).toBe("text");
    const hide = screen.getByRole("button", { name: "Nascondi" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
  });

  it("makes every button a 44 px target", () => {
    render(createElement(PasswordForm, { next: undefined }));
    for (const button of screen.getAllByRole("button")) {
      expect(button.className, button.textContent ?? "").toContain("min-h-tap");
    }
  });
});

describe("PasswordForm, the link and code path", () => {
  it("Inviami il link without an e-mail says so and sends nothing", () => {
    render(createElement(PasswordForm, { next: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "Inviami il link" }));
    expect(screen.getByRole("alert").textContent).toBe("Scrivi prima la tua email.");
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("with an e-mail it posts the link request, then offers the code field and no password field", async () => {
    replies["/api/auth/magic-link"] = { ok: true, status: 202, data: { status: "sent" } };
    render(createElement(PasswordForm, { next: "/report" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: "Inviami il link" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("riceverai un'email");
    expect(status.textContent).toContain("codice di 6 cifre");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/auth/magic-link");
    expect(calls[0]!.init).toMatchObject({
      method: "POST",
      body: { email: EMAIL, next: "/report" },
    });

    const code = screen.getByLabelText("Codice di 6 cifre");
    expect(code.getAttribute("inputmode")).toBe("numeric");
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");
    expect(code.getAttribute("maxlength")).toBe("6");
    expect(code.getAttribute("pattern")).toBe("[0-9]{6}");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("a failed link request shows an error and stays on the password view", async () => {
    replies["/api/auth/magic-link"] = {
      ok: false,
      status: 429,
      error: { code: "rate_limited", message: "Troppi tentativi. Riprova tra qualche minuto." },
    };
    render(createElement(PasswordForm, { next: undefined }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: "Inviami il link" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Troppi tentativi. Riprova tra qualche minuto.",
    );
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  async function reachCodeStage() {
    replies["/api/auth/magic-link"] = { ok: true, status: 202, data: { status: "sent" } };
    render(createElement(PasswordForm, { next: undefined }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: "Inviami il link" }));
    await screen.findByLabelText("Codice di 6 cifre");
    calls.length = 0;
  }

  it("Entra con il codice posts the code and follows the redirect", async () => {
    await reachCodeStage();
    replies["/api/auth/email-code"] = {
      ok: true,
      status: 200,
      data: { redirect: "/password?dopo=%2F" },
    };
    fireEvent.change(screen.getByLabelText("Codice di 6 cifre"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Entra con il codice" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/password?dopo=%2F"));
    expect(calls[0]!.path).toBe("/api/auth/email-code");
    expect(calls[0]!.init).toMatchObject({
      method: "POST",
      body: { email: EMAIL, code: "123456" },
    });
    expect(forgetUser).toHaveBeenCalledTimes(1);
  });

  it("a 422 shows the server's message and keeps the code field", async () => {
    await reachCodeStage();
    replies["/api/auth/email-code"] = {
      ok: false,
      status: 422,
      error: { code: "code_invalid", message: "Codice non valido o scaduto. Chiedine uno nuovo." },
    };
    fireEvent.change(screen.getByLabelText("Codice di 6 cifre"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Entra con il codice" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Codice non valido o scaduto. Chiedine uno nuovo.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps only digits in the code field", async () => {
    await reachCodeStage();
    const code = screen.getByLabelText("Codice di 6 cifre") as HTMLInputElement;
    fireEvent.change(code, { target: { value: "12 34ab56789" } });
    expect(code.value).toBe("123456");
  });

  it("Torna alla password brings the password field back", async () => {
    await reachCodeStage();
    fireEvent.click(screen.getByRole("button", { name: "Torna alla password" }));
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByLabelText("Codice di 6 cifre")).toBeNull();
  });
});
