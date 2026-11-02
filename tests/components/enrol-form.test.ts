// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

let reply: Reply;
const apiJson = vi.fn((_path: string, _init?: unknown): Promise<Reply> => Promise.resolve(reply));
const replace = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: unknown) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { EnrolForm } from "@/app/(public)/dispositivo/enrol-form";

beforeEach(() => {
  apiJson.mockClear();
  replace.mockClear();
});
afterEach(cleanup);

describe("EnrolForm", () => {
  it("has a labelled code field that capitalises, with the hint", () => {
    render(createElement(EnrolForm));
    const input = screen.getByLabelText(/Codice di abilitazione/);
    expect(input.getAttribute("autocapitalize")).toBe("characters");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(screen.getByText("Lo trovi sul telefono del titolare, vale 15 minuti.")).toBeTruthy();
  });

  it("has one primary button", () => {
    render(createElement(EnrolForm));
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe("Abilita");
    expect(buttons[0]!.getAttribute("type")).toBe("submit");
  });

  it("explains the installed-app case (Q12)", () => {
    render(createElement(EnrolForm));
    expect(
      screen.getByText("Se usi l'app installata sulla schermata Home, abilitala da lì."),
    ).toBeTruthy();
  });

  it("on success goes straight to the PIN screen: no extra link, no extra tap (M25a)", async () => {
    reply = { ok: true, status: 201, data: { device: { label: "Telefono sala (demo)" } } };
    render(createElement(EnrolForm));
    fireEvent.change(screen.getByLabelText(/Codice di abilitazione/), {
      target: { value: "K7M2QX9P" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Abilita" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?abilitato=1"));
    expect(apiJson).toHaveBeenCalledWith("/api/devices/enrol", {
      method: "POST",
      body: { code: "K7M2QX9P" },
    });
    expect(screen.queryByText("Vai all'accesso con PIN")).toBeNull();
  });

  it("on a wrong code stays on the form with the message", async () => {
    reply = {
      ok: false,
      status: 422,
      error: { code: "enrolment_code_invalid", message: "x" },
    };
    render(createElement(EnrolForm));
    fireEvent.change(screen.getByLabelText(/Codice di abilitazione/), {
      target: { value: "NOPE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Abilita" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Codice");
    expect(replace).not.toHaveBeenCalled();
  });
});
