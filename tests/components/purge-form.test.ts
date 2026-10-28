// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const NAME = "Osteria Demo (dati di prova)";
let meReply: Result;
let purgeReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path === "/api/me") return Promise.resolve(meReply);
  if (path === "/api/demo/purge") return Promise.resolve(purgeReply);
  return Promise.resolve({ ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));
const replace = vi.fn();
const resetMe = vi.fn();
vi.mock("@/components/use-me", () => ({ resetMe: () => resetMe() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
vi.stubGlobal("fetch", fetchMock);

import DemoDataPage from "@/app/(owner)/impostazioni/dati-di-prova/page";

const me = (role: string, isDemo: boolean): Result => ({
  ok: true,
  status: 200,
  data: { user: { role }, tenant: { id: "t", name: NAME, isDemo } },
});
const input = () => screen.getByLabelText(/^Scrivi il nome del locale/) as HTMLInputElement;
const button = () =>
  screen.getByRole("button", { name: "Elimina dati di prova" }) as HTMLButtonElement;
const purges = () => calls.filter((c) => c.path === "/api/demo/purge");

beforeEach(() => {
  calls.length = 0;
  apiJson.mockClear();
  replace.mockClear();
  resetMe.mockClear();
  fetchMock.mockClear();
  meReply = me("owner", true);
  purgeReply = { ok: true, status: 200, data: { purged: true } };
});
afterEach(cleanup);

describe("Dati di prova page", () => {
  it("owner of a demo tenant: the button is disabled until the exact name is typed", async () => {
    render(createElement(DemoDataPage));
    await screen.findByLabelText(/^Scrivi il nome del locale/);
    expect(button().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "osteria demo" } });
    expect(button().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: `${NAME} ` } });
    expect(button().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: NAME } });
    expect(button().disabled).toBe(false);
    expect(purges()).toHaveLength(0);
  });

  it("says plainly that ALL operational data entered since the demo was loaded goes, real or not, and that the venue stays", async () => {
    render(createElement(DemoDataPage));
    await screen.findByLabelText(/^Scrivi il nome del locale/);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/tutti i dati operativi/);
    expect(text).toMatch(/inseriti dopo il caricamento dei dati di prova/);
    expect(text).toMatch(/anche per quello che hai inserito tu nel frattempo, vero o di prova/);
    expect(text).toMatch(/Il locale e i suoi utenti restano/);
    expect(text).toMatch(/il personale creato con gli accessi di prova viene eliminato/);
    expect(text).toMatch(/Non si può annullare/);
  });

  it("shows the name to type", async () => {
    render(createElement(DemoDataPage));
    await screen.findByLabelText(/^Scrivi il nome del locale/);
    expect(screen.getByText(NAME)).toBeTruthy();
  });

  it("pressing the button posts the typed name, then confirms, signs out and goes to /login", async () => {
    render(createElement(DemoDataPage));
    await screen.findByLabelText(/^Scrivi il nome del locale/);
    fireEvent.change(input(), { target: { value: NAME } });
    fireEvent.click(button());
    await screen.findByText("Dati di prova eliminati.");
    expect(purges()).toHaveLength(1);
    expect(purges()[0]!.init).toEqual({ method: "POST", body: { confirmName: NAME } });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    // The session ended: the cached user must not survive on a shared device.
    expect(resetMe).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("a 422 shows the server's message above the button and does not leave the page", async () => {
    purgeReply = {
      ok: false,
      status: 422,
      error: { code: "confirm_name_mismatch", message: "Il nome non corrisponde." },
    };
    render(createElement(DemoDataPage));
    await screen.findByLabelText(/^Scrivi il nome del locale/);
    fireEvent.change(input(), { target: { value: NAME } });
    fireEvent.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Il nome non corrisponde.");
    expect(replace).not.toHaveBeenCalled();
    expect(resetMe).not.toHaveBeenCalled();
    expect(screen.queryByText("Dati di prova eliminati.")).toBeNull();
    expect(alert.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["a real tenant", "owner", false],
    ["an admin of the demo", "admin", true],
    ["a chef of the demo", "chef", true],
  ])("%s: the 'no demo data' text and no button", async (_label, role, isDemo) => {
    meReply = me(role, isDemo);
    render(createElement(DemoDataPage));
    await screen.findByText("Questo locale non contiene dati di prova.");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText(/^Scrivi il nome/)).toBeNull();
  });

  it("a failed /api/me shows its message and no button", async () => {
    meReply = { ok: false, status: 500, error: { code: "internal", message: "Errore interno." } };
    render(createElement(DemoDataPage));
    expect((await screen.findByRole("alert")).textContent).toBe("Errore interno.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
