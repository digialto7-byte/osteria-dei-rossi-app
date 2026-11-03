// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined }) }));
vi.mock("@/lib/api/client", () => ({
  apiJson: vi.fn(async () => ({ ok: false, status: 400, error: { code: "x", message: "no" } })),
}));

import { apiJson } from "@/lib/api/client";

import { PasswordForm as OwnerPasswordForm } from "@/app/(owner)/password/password-form";
import { PinForm } from "@/app/(owner)/personale/pin-form";
import { EnrolForm } from "@/app/(public)/dispositivo/enrol-form";
import { CodeForm } from "@/app/(public)/login/code-form";
import { PasswordForm } from "@/app/(public)/login/password-form";
import { PinPad } from "@/app/(public)/pin/pin-pad";

// A tap before React hydrates submits the form natively (no handler yet). Two guards, for every form that takes a
// secret: it is a POST form (so the secret never reaches a URL), and the buttons that send it wait for hydration.
// renderToStaticMarkup is the server render, the HTML a phone gets first; render() is the browser after hydration.

const noop = () => undefined;
const status = {
  signInMethod: "link",
  recentSignIn: true,
  recentUntil: null,
  minLength: 10,
} as const;
const staff = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Cameriere Demo",
  role: "waiter",
  loginMethod: "pin",
  active: true,
  lockedUntil: null,
} as const;

interface Case {
  name: string;
  element: () => ReactElement;
  /** The buttons that send a request. */
  sending: string[];
  /** Buttons that only change the screen: they stay usable. */
  local?: string[];
  field: string;
}

const cases: Case[] = [
  {
    name: "login, password",
    element: () => createElement(PasswordForm, { next: undefined }),
    sending: ["Accedi con la password", "Inviami il link"],
    local: ["Mostra"],
    field: "password",
  },
  {
    name: "login, e-mail code",
    element: () =>
      createElement(CodeForm, { email: "a@example.test", next: undefined, onBack: noop }),
    sending: ["Entra con il codice"],
    local: ["Torna alla password"],
    field: "code",
  },
  {
    name: "staff PIN",
    element: () =>
      createElement(PinPad, {
        name: "Cameriere Demo",
        pin: "4827",
        busy: false,
        message: null,
        onChange: noop,
        onSubmit: noop,
        onBack: noop,
      }),
    sending: ["Entra"],
    local: ["Cambia persona"],
    field: "pin",
  },
  {
    name: "device enrolment",
    element: () => createElement(EnrolForm),
    sending: ["Abilita"],
    field: "code",
  },
  {
    name: "owner password",
    element: () => createElement(OwnerPasswordForm, { status, onSaved: noop, skip: null }),
    sending: ["Salva password"],
    local: ["Mostra"],
    field: "newPassword",
  },
  {
    name: "owner reset of a staff PIN",
    element: () => createElement(PinForm, { item: staff, onSaved: noop, onCancel: noop }),
    sending: ["Salva PIN"],
    local: ["Annulla"],
    field: "pin",
  },
];

afterEach(cleanup);

function buttonsOf(html: string): Map<string, boolean> {
  const host = document.createElement("div");
  host.innerHTML = html;
  return new Map(
    [...host.querySelectorAll("button")].map((button) => [
      button.textContent ?? "",
      button.disabled,
    ]),
  );
}

describe.each(cases)("$name form", ({ element, sending, local = [], field }) => {
  it("is a POST form, so an early native submit never puts the values in a URL", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(element());
    const form = host.querySelector("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(host.querySelector(`[name="${field}"]`)).not.toBeNull();
  });

  it("has the buttons that send a request disabled in the server render", () => {
    const buttons = buttonsOf(renderToStaticMarkup(element()));
    for (const label of sending) expect(buttons.get(label), label).toBe(true);
  });

  it("leaves the buttons that only change the screen usable", () => {
    const buttons = buttonsOf(renderToStaticMarkup(element()));
    for (const label of local) {
      expect(buttons.get(label), label).toBe(false);
    }
  });

  it("enables them once the component runs in the browser", () => {
    render(element());
    for (const label of sending) {
      expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    }
  });
});

// The secret inputs are never readonly: a password manager skips a readonly field, and low-friction sign-in on a
// phone comes first. The POST method and the disabled send buttons (above) are what keep an early tap harmless.
// Their values are read from the DOM at send time, so text typed or autofilled before hydration is what is sent.
const needsCurrent = { ...status, recentSignIn: false } as const;

interface Inputs {
  name: string;
  element: () => ReactElement;
  fields: string[];
}

const inputs: Inputs[] = [
  {
    name: "login, password",
    element: () => createElement(PasswordForm, { next: undefined }),
    fields: ["email", "password"],
  },
  {
    name: "owner password, current and new",
    element: () =>
      createElement(OwnerPasswordForm, { status: needsCurrent, onSaved: noop, skip: null }),
    fields: ["currentPassword", "newPassword"],
  },
  {
    name: "owner reset of a staff PIN",
    element: () => createElement(PinForm, { item: staff, onSaved: noop, onCancel: noop }),
    fields: ["pin", "repeat"],
  },
  {
    name: "login, e-mail code",
    element: () =>
      createElement(CodeForm, { email: "a@example.test", next: undefined, onBack: noop }),
    fields: ["code"],
  },
  {
    name: "staff PIN pad",
    element: () =>
      createElement(PinPad, {
        name: "Cameriere Demo",
        pin: "",
        busy: false,
        message: null,
        onChange: noop,
        onSubmit: noop,
        onBack: noop,
      }),
    fields: ["pin"],
  },
];

describe.each(inputs)("$name inputs", ({ element, fields }) => {
  it("are not readonly in the server render", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(element());
    for (const field of fields) {
      const input = host.querySelector<HTMLInputElement>(`[name="${field}"]`);
      expect(input, field).not.toBeNull();
      expect(input?.readOnly, field).toBe(false);
    }
  });

  it("are not readonly once the component runs in the browser", () => {
    const { container } = render(element());
    for (const field of fields) {
      const input = container.querySelector<HTMLInputElement>(`[name="${field}"]`);
      expect(input, field).not.toBeNull();
      expect(input?.readOnly, field).toBe(false);
    }
  });
});

// Playwright waits for this marker before it types: it is on the form once React has taken over, never in the server HTML.
const marked: { name: string; element: () => ReactElement }[] = [
  ...cases.map(({ name, element }) => ({ name, element })),
];

describe.each(marked)("$name form hydration marker", ({ element }) => {
  it("is absent in the server render", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(element());
    expect(host.querySelector("form")?.hasAttribute("data-hydrated")).toBe(false);
  });

  it("is data-hydrated=true after mount", () => {
    const { container } = render(element());
    expect(container.querySelector("form")?.getAttribute("data-hydrated")).toBe("true");
  });
});

const hydratedRoots: Root[] = [];

/** The page as a phone gets it: server HTML first, then values typed or autofilled, then React takes over. */
async function hydrateAfterTyping(
  element: ReactElement,
  typed: Record<string, string>,
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(element);
  for (const [name, value] of Object.entries(typed)) {
    container.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
  }
  await act(async () => {
    hydratedRoots.push(hydrateRoot(container, element));
  });
  return container;
}

function submitOf(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form")!);
}

describe("values typed before hydration", () => {
  afterEach(async () => {
    await act(async () => {
      for (const root of hydratedRoots.splice(0)) root.unmount();
    });
    vi.mocked(apiJson).mockClear();
    document.body.innerHTML = "";
  });

  it("login password form sends the typed e-mail and password", async () => {
    const container = await hydrateAfterTyping(createElement(PasswordForm, { next: undefined }), {
      email: "a@example.test",
      password: "una frase di prova",
    });
    expect(container.querySelector<HTMLInputElement>('[name="password"]')?.value).toBe(
      "una frase di prova",
    );
    await act(async () => submitOf(container));
    expect(apiJson).toHaveBeenCalledWith("/api/auth/password", {
      method: "POST",
      body: { email: "a@example.test", password: "una frase di prova", next: undefined },
    });
  });

  it("login 'Inviami il link' sends the typed e-mail", async () => {
    const container = await hydrateAfterTyping(createElement(PasswordForm, { next: undefined }), {
      email: "a@example.test",
    });
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Inviami il link",
    )!;
    await act(async () => fireEvent.click(button));
    expect(apiJson).toHaveBeenCalledWith("/api/auth/magic-link", {
      method: "POST",
      body: { email: "a@example.test", next: undefined },
    });
  });

  it("login e-mail typed before hydration is what the code form sends, and what 'Torna alla password' refills", async () => {
    const container = await hydrateAfterTyping(createElement(PasswordForm, { next: undefined }), {
      email: "a@example.test",
    });
    vi.mocked(apiJson).mockResolvedValueOnce({ ok: true, status: 200, data: undefined });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Inviami il link" })));
    expect(apiJson).toHaveBeenCalledWith("/api/auth/magic-link", {
      method: "POST",
      body: { email: "a@example.test", next: undefined },
    });
    // The stage is now the code form.
    const code = container.querySelector<HTMLInputElement>('[name="code"]')!;
    expect(code).not.toBeNull();
    await act(async () => fireEvent.change(code, { target: { value: "123456" } }));
    await act(async () => submitOf(container));
    expect(apiJson).toHaveBeenCalledWith("/api/auth/email-code", {
      method: "POST",
      body: { email: "a@example.test", code: "123456", next: undefined },
    });

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Torna alla password" })),
    );
    expect(container.querySelector<HTMLInputElement>('[name="email"]')?.value).toBe(
      "a@example.test",
    );
  });

  it("login password form clears the password after a refused sign-in, keeps the e-mail", async () => {
    const container = await hydrateAfterTyping(createElement(PasswordForm, { next: undefined }), {
      email: "a@example.test",
      password: "sbagliata",
    });
    await act(async () => submitOf(container));
    expect(container.querySelector<HTMLInputElement>('[name="password"]')?.value).toBe("");
    expect(container.querySelector<HTMLInputElement>('[name="email"]')?.value).toBe(
      "a@example.test",
    );
  });

  it("login password form still shows and hides the password", async () => {
    const container = await hydrateAfterTyping(createElement(PasswordForm, { next: undefined }), {
      password: "visibile",
    });
    const input = () => container.querySelector<HTMLInputElement>('[name="password"]')!;
    expect(input().type).toBe("password");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mostra" })));
    expect(input().type).toBe("text");
    expect(input().value).toBe("visibile");
  });

  it("owner password form sends the typed current and new password", async () => {
    const container = await hydrateAfterTyping(
      createElement(OwnerPasswordForm, { status: needsCurrent, onSaved: noop, skip: null }),
      { currentPassword: "la vecchia frase", newPassword: "la nuova frase lunga" },
    );
    await act(async () => submitOf(container));
    expect(apiJson).toHaveBeenCalledWith("/api/me/password", {
      method: "POST",
      body: { newPassword: "la nuova frase lunga", currentPassword: "la vecchia frase" },
    });
  });
});
