// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const RECENT_LINK: Reply = {
  ok: true,
  status: 200,
  data: {
    signInMethod: "link",
    recentSignIn: true,
    recentUntil: "2026-11-20T10:10:00.000Z",
    minLength: 10,
  },
};
const OLD_PASSWORD: Reply = {
  ok: true,
  status: 200,
  data: { signInMethod: "password", recentSignIn: false, recentUntil: null, minLength: 10 },
};

let statusReply: Reply;
let saveReply: Reply;
const calls: { path: string; init?: { method?: string; body?: unknown } }[] = [];
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  calls.push({ path, init });
  return Promise.resolve(init?.method === "POST" ? saveReply : statusReply);
});
const replace = vi.fn();
let search = "";
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

import PasswordPage from "@/app/(owner)/password/page";

const GOOD = "una frase lunga per il locale";

beforeEach(() => {
  calls.length = 0;
  search = "";
  apiJson.mockClear();
  replace.mockClear();
  statusReply = RECENT_LINK;
  saveReply = { ok: true, status: 200, data: { status: "saved" } };
});
afterEach(cleanup);

const open = async () => {
  render(createElement(PasswordPage));
  await screen.findByLabelText("Nuova password");
};

describe("the password page, after a recent link or code sign-in", () => {
  it("reads the status exactly once", async () => {
    await open();
    expect(calls.filter((c) => c.path === "/api/me/password")).toHaveLength(1);
    expect(calls[0]!.init?.method ?? "GET").toBe("GET");
  });

  it("starts with the back link to Home, before the heading Password", async () => {
    await open();
    const link = screen.getAllByRole("link")[0]!;
    expect(link.getAttribute("href")).toBe("/");
    expect(link.textContent).toContain("Home");
    const heading = screen.getByRole("heading", { name: "Password", level: 1 });
    expect(link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers to set a password, with no current-password field", async () => {
    await open();
    expect(
      screen.getByText("Imposta una password: la prossima volta entri senza aspettare l'email."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Password attuale")).toBeNull();
    const field = screen.getByLabelText("Nuova password");
    expect(field.getAttribute("autocomplete")).toBe("new-password");
    expect(
      screen.getByText("Almeno 10 caratteri. Una frase facile da ricordare va benissimo."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Non ricordi la password attuale? Entra con un codice via email"),
    ).toBeNull();
  });

  it("saves with exactly the filled fields and says the other devices must sign in again", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    const note = await screen.findByRole("status");
    expect(note.textContent).toBe(
      "Password salvata. Gli altri dispositivi usciranno a breve, al massimo entro un'ora.",
    );
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.path).toBe("/api/me/password");
    expect(post.init?.body).toEqual({ newPassword: GOOD });
    expect(replace).not.toHaveBeenCalled();
  });

  it("with ?dopo= goes on to that page after saving", async () => {
    search = "dopo=%2Freport";
    await open();
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/report"));
  });

  it("Non ora points at ?dopo=, and at the home page when that is not a same-origin path", async () => {
    search = "dopo=%2Freport";
    await open();
    expect(screen.getByRole("link", { name: "Non ora" }).getAttribute("href")).toBe("/report");
    cleanup();
    search = "dopo=https%3A%2F%2Fevil.test";
    await open();
    expect(screen.getByRole("link", { name: "Non ora" }).getAttribute("href")).toBe("/");
  });

  it("has no Non ora without ?dopo=", async () => {
    await open();
    expect(screen.queryByRole("link", { name: "Non ora" })).toBeNull();
  });

  it("shows the server's message when the password is refused", async () => {
    saveReply = {
      ok: false,
      status: 422,
      error: {
        code: "password_weak",
        message: "Questa password è troppo comune: scegline un'altra.",
      },
    };
    await open();
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: "basketball" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Questa password è troppo comune: scegline un'altra.",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("Mostra shows the new password", async () => {
    await open();
    const field = screen.getByLabelText("Nuova password");
    fireEvent.click(screen.getByRole("button", { name: "Mostra" }));
    expect(field.getAttribute("type")).toBe("text");
  });
});

describe("the password page, after an old sign-in", () => {
  beforeEach(() => {
    statusReply = OLD_PASSWORD;
  });

  it("asks for the current password and offers the code way out", async () => {
    await open();
    expect(screen.getByText("Cambia la password di accesso.")).toBeTruthy();
    const current = screen.getByLabelText("Password attuale");
    expect(current.getAttribute("autocomplete")).toBe("current-password");
    const link = screen.getByRole("link", {
      name: "Non ricordi la password attuale? Entra con un codice via email",
    });
    expect(link.getAttribute("href")).toBe("/login?next=%2Fpassword");
  });

  it("sends both fields", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Password attuale"), {
      target: { value: "la vecchia 42" },
    });
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    await screen.findByRole("status");
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.init?.body).toEqual({ newPassword: GOOD, currentPassword: "la vecchia 42" });
  });
});

describe("the password page, when the recent sign-in lapses while it is open", () => {
  it("on current_password_required re-reads the status and shows the field and the code link", async () => {
    await open();
    expect(screen.queryByLabelText("Password attuale")).toBeNull();
    statusReply = {
      ok: true,
      status: 200,
      data: { signInMethod: "link", recentSignIn: false, recentUntil: null, minLength: 10 },
    };
    saveReply = {
      ok: false,
      status: 422,
      error: { code: "current_password_required", message: "Scrivi la password attuale." },
    };
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Scrivi la password attuale.");
    expect(await screen.findByLabelText("Password attuale")).toBeTruthy();
    // With the current password asked for, this is a change, not a first set.
    expect(screen.getByText("Cambia la password di accesso.")).toBeTruthy();
    expect(screen.queryByText(/^Imposta una password/)).toBeNull();
    expect(
      screen
        .getByRole("link", {
          name: "Non ricordi la password attuale? Entra con un codice via email",
        })
        .getAttribute("href"),
    ).toBe("/login?next=%2Fpassword");
    expect(calls.filter((c) => (c.init?.method ?? "GET") === "GET")).toHaveLength(2);
    expect((screen.getByLabelText("Nuova password") as HTMLInputElement).value).toBe(GOOD);
  });

  it("shows the field even when the re-read fails", async () => {
    await open();
    statusReply = { ok: false, status: 500, error: { code: "internal", message: "x" } };
    saveReply = {
      ok: false,
      status: 422,
      error: { code: "current_password_required", message: "Scrivi la password attuale." },
    };
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    expect(await screen.findByLabelText("Password attuale")).toBeTruthy();
  });
});

describe("the password page for other roles and failures", () => {
  it("shows the reserved message on 403 and no form", async () => {
    statusReply = {
      ok: false,
      status: 403,
      error: { code: "forbidden", message: "x" },
    };
    render(createElement(PasswordPage));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Solo il titolare e l'amministratore possono cambiare la password.",
    );
    expect(screen.queryByLabelText("Nuova password")).toBeNull();
  });

  it("shows the error when the status cannot be read", async () => {
    statusReply = {
      ok: false,
      status: 500,
      error: { code: "internal", message: "Errore interno." },
    };
    render(createElement(PasswordPage));
    expect((await screen.findByRole("alert")).textContent).toBe("Errore interno.");
  });
});

describe("the password page, when the new session needs the code (P2-1 B7)", () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockClear();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
  });

  it("mfa: challenge sends the browser to the code page, with ?dopo as the way back", async () => {
    search = "dopo=%2Freport";
    saveReply = { ok: true, status: 200, data: { status: "saved", mfa: "challenge" } };
    await open();
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login/codice?next=%2Freport"));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("mfa: challenge with no ?dopo falls back to the landing page", async () => {
    saveReply = { ok: true, status: 200, data: { status: "saved", mfa: "challenge" } };
    await open();
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login/codice?next=%2F"));
  });

  it("mfa: none keeps today's behaviour: the success note and ?dopo via the router", async () => {
    search = "dopo=%2Freport";
    saveReply = { ok: true, status: 200, data: { status: "saved", mfa: "none" } };
    await open();
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/report"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("no mfa field is treated as today's behaviour", async () => {
    saveReply = { ok: true, status: 200, data: { status: "saved" } };
    await open();
    fireEvent.change(screen.getByLabelText("Nuova password"), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole("button", { name: "Salva password" }));
    await screen.findByRole("status");
    expect(assign).not.toHaveBeenCalled();
  });
});
