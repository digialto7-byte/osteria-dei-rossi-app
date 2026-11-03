// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined }) }));

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
