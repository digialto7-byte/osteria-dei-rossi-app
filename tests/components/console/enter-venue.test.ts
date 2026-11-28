// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_TENANT_ID } from "./console-fixtures";

// SP3 step 19 (docs/plans/2026-11-15-sp3-console.md §3.7; Q-P15): «Entra nel locale». Only where DigiAlto is attached; a confirmation with the §3.7 text before any
// request; then POST /api/platform/tenants/<id>/open (the audit row) and the returned URL in a new tab, without an opener.
type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const calls: { path: string; method?: string; body?: unknown }[] = [];
let reply: Reply | "pending" = { ok: true, status: 200, data: {} };
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (reply === "pending") return new Promise(() => undefined);
    return Promise.resolve(reply);
  },
}));

const { EnterVenue } = await import("@/components/console/enter-venue");

const OPEN = `/api/platform/tenants/${DEMO_TENANT_ID}/open`;
const URL_OK = `https://app.example.test/login/scegli-locale?locale=${DEMO_TENANT_ID}`;
const openSpy = vi.fn();
const mount = (attached: boolean) =>
  render(createElement(EnterVenue, { tenantId: DEMO_TENANT_ID, attached }));
const enterButton = () => screen.getByRole("button", { name: "Entra nel locale" });

beforeEach(() => {
  calls.length = 0;
  reply = { ok: true, status: 200, data: { url: URL_OK } };
  openSpy.mockReset();
  vi.stubGlobal("open", openSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EnterVenue", () => {
  it("is disabled with «DigiAlto non è collegato a questo locale.» when digialtoAttached is false", () => {
    mount(false);
    const button = enterButton();
    expect(button.hasAttribute("disabled")).toBe(true);
    const note = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(note?.textContent).toBe("DigiAlto non è collegato a questo locale.");
    fireEvent.click(button);
    expect(calls).toEqual([]);
  });

  it("is enabled when DigiAlto is attached, and a tap asks first: the §3.7 text, no request yet", () => {
    mount(true);
    fireEvent.click(enterButton());
    expect(
      screen.getByText(/Entri nel locale con il tuo account DigiAlto\./).textContent,
    ).toContain("Ogni modifica che fai resta nel registro del locale, visibile al titolare.");
    expect(screen.getByText(/Nel locale serve un accesso separato da questo\./)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("«Annulla» closes the question and sends nothing", () => {
    mount(true);
    fireEvent.click(enterButton());
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByText(/Entri nel locale/)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("confirming posts /open once and opens the returned URL in a new tab with noopener", async () => {
    mount(true);
    fireEvent.click(enterButton());
    fireEvent.click(screen.getByRole("button", { name: "Entra" }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ path: OPEN, method: "POST", body: {} }]);
    expect(openSpy).toHaveBeenCalledWith(URL_OK, "_blank", "noopener,noreferrer");
    const link = screen.getByRole("link", { name: "Apri il locale" });
    expect(link.getAttribute("href")).toBe(URL_OK);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("while the request runs, a second tap sends nothing", () => {
    reply = "pending";
    mount(true);
    fireEvent.click(enterButton());
    const confirm = screen.getByRole("button", { name: "Entra" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(calls).toHaveLength(1);
  });

  it("409 digialto_not_attached says so; another failure says it could not open the venue", async () => {
    reply = { ok: false, status: 409, error: { code: "digialto_not_attached", message: "x" } };
    mount(true);
    fireEvent.click(enterButton());
    fireEvent.click(screen.getByRole("button", { name: "Entra" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "DigiAlto non è collegato a questo locale.",
    );
    cleanup();
    reply = { ok: false, status: 404, error: { code: "tenant_not_found", message: "x" } };
    mount(true);
    fireEvent.click(enterButton());
    fireEvent.click(screen.getByRole("button", { name: "Entra" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Non riesco ad aprire il locale.");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("a returned URL that is not http(s) is never opened", async () => {
    reply = { ok: true, status: 200, data: { url: "javascript:alert(1)" } };
    mount(true);
    fireEvent.click(enterButton());
    fireEvent.click(screen.getByRole("button", { name: "Entra" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Non riesco ad aprire il locale.");
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
