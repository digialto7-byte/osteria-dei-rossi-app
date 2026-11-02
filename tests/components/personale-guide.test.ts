// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupGuide } from "@/app/(owner)/personale/setup-guide";
import { setupGuide } from "@/lib/staff-auth/setup-guide";

afterEach(cleanup);

const guide = (staffCount: number, deviceCount: number, pinLoginReady = true) =>
  setupGuide({ staffCount, deviceCount, pinLoginReady });
const open = (g: ReturnType<typeof guide>) => render(createElement(SetupGuide, { guide: g }));

describe("SetupGuide, expanded", () => {
  it("is a card headed Come far entrare il personale, with four ordered steps", () => {
    open(guide(0, 0));
    expect(screen.getByRole("heading", { name: "Come far entrare il personale" })).toBeTruthy();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(items[0]!.textContent).toContain("Aggiungi le persone");
    expect(items[0]!.textContent).toContain("Nome, ruolo e un PIN di 4 cifre.");
    expect(items[1]!.textContent).toContain("Installa l'app sui telefoni di sala e cucina");
    expect(items[1]!.textContent).toContain(
      "Su iPhone: Safari → Condividi → Aggiungi alla schermata Home. Su Android: Chrome → menu → Installa app.",
    );
    expect(items[2]!.textContent).toContain("Abilita ogni telefono");
    expect(items[2]!.textContent).toContain(
      "Apri l'app installata, tocca «Abilita questo telefono per il personale» e scrivi il codice che crei in Dispositivi. Il codice vale 15 minuti.",
    );
    expect(items[3]!.textContent).toContain("Ogni persona entra con nome e PIN");
    expect(items[3]!.textContent).toContain("Dopo 5 PIN sbagliati la persona aspetta 15 minuti");
  });

  it("shows Da fare on steps 1 and 3 when nothing is set up, and no badge on 2 and 4", () => {
    open(guide(0, 0));
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("Da fare");
    expect(items[1]!.textContent).not.toMatch(/Da fare|Fatto/);
    expect(items[2]!.textContent).toContain("Da fare");
    expect(items[3]!.textContent).not.toMatch(/Da fare|Fatto/);
  });

  it("shows Fatto on the steps that are done", () => {
    open(guide(2, 0));
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("Fatto");
    expect(items[2]!.textContent).toContain("Da fare");
  });

  it("puts a warning first when PIN login is not active at the server", () => {
    open(guide(0, 0, false));
    const warning = screen.getByText(
      "L'accesso con PIN non è ancora attivo su questo server. Contatta l'assistenza.",
    );
    const list = screen.getByRole("list");
    expect(warning.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(warning.textContent).not.toMatch(/digialto/i);
  });

  it("shows no warning when it is ready", () => {
    open(guide(0, 0));
    expect(screen.queryByText(/non è ancora attivo/)).toBeNull();
  });
});

describe("SetupGuide, collapsed", () => {
  it("is a quiet button with aria-expanded, and opens on tap", () => {
    open(guide(2, 1));
    expect(screen.queryByRole("list")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Guida: come far entrare il personale" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[0]!.textContent).toContain("Fatto");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("an expanded guide has no toggle", () => {
    open(guide(0, 0));
    expect(
      screen.queryByRole("button", { name: "Guida: come far entrare il personale" }),
    ).toBeNull();
  });

  it("does not compute anything itself: the component file imports no count logic", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/(owner)/personale/setup-guide.tsx", "utf8");
    expect(source).not.toMatch(/\.length|\.filter\(|staffCount|deviceCount/);
  });
});

// The page: reads /api/users and /api/devices, feeds the helper, and keeps at most two cards.
type Reply = { ok: true; status: number; data: unknown };
let users: Reply;
let devices: Reply;
const apiJson = vi.fn((path: string): Promise<Reply> => {
  if (path === "/api/users") return Promise.resolve(users);
  if (path === "/api/devices") return Promise.resolve(devices);
  return Promise.resolve({ ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string) => apiJson(path),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import StaffPage from "@/app/(owner)/personale/page";

const person = (active: boolean) => ({
  id: crypto.randomUUID(),
  displayName: "Cameriere Demo",
  role: "waiter",
  loginMethod: "pin",
  active,
  lockedUntil: null,
});

describe("the personale page", () => {
  it("reads both lists and shows the guide expanded for a new venue, with the warning when not ready", async () => {
    users = { ok: true, status: 200, data: { staff: [] } };
    devices = {
      ok: true,
      status: 200,
      data: { devices: [], pendingCodes: [], pinLoginReady: false },
    };
    render(createElement(StaffPage));
    expect(
      await screen.findByRole("heading", { name: "Come far entrare il personale" }),
    ).toBeTruthy();
    expect(screen.getByText(/non è ancora attivo/)).toBeTruthy();
    expect(apiJson.mock.calls.map(([p]) => p).sort()).toEqual(["/api/devices", "/api/users"]);
  });

  it("collapses the guide once a person and a device exist", async () => {
    users = { ok: true, status: 200, data: { staff: [person(true), person(false)] } };
    devices = {
      ok: true,
      status: 200,
      data: {
        devices: [{ id: "d1", label: "Telefono sala (demo)", status: "attivo" }],
        pendingCodes: [],
        pinLoginReady: true,
      },
    };
    render(createElement(StaffPage));
    expect(
      await screen.findByRole("button", { name: "Guida: come far entrare il personale" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Come far entrare il personale" })).toBeNull();
  });

  it("still lists the staff when the devices cannot be read, without a guide", async () => {
    users = { ok: true, status: 200, data: { staff: [person(true)] } };
    devices = { ok: true, status: 200, data: {} };
    render(createElement(StaffPage));
    expect(await screen.findByText("Cameriere Demo")).toBeTruthy();
  });
});
