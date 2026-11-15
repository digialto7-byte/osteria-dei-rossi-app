// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditRow, DEMO_TENANT_ID, tenantDetail } from "./console-fixtures";

// SP3 step 18, step 18: the venue detail. Metadata only; the read is GET /api/platform/tenants/<id>.

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const calls: { path: string; method: string | undefined }[] = [];
let replies: Record<string, (Reply | "pending")[]> = {};
const apiJson = vi.fn((path: string, init?: { method?: string }) => {
  calls.push({ path, method: init?.method });
  const next = replies[path]?.shift();
  if (next === "pending") return new Promise(() => undefined);
  return Promise.resolve(next ?? { ok: true, status: 200, data: {} });
});
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiJson: (path: string, init?: { method?: string }) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => `/locali/${"a0000000-0000-4000-8000-00000000000a"}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import VenuePage from "@/app/(platform)/console/(shell)/locali/[id]/page";
import { VenueDetail } from "@/components/console/venue-detail";

const PATH = `/api/platform/tenants/${DEMO_TENANT_ID}`;
const MODE = "/api/platform/console";
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
const ok = (data: unknown): Reply => ({ ok: true, status: 200, data });
const fail = (status: number, code: string): Reply => ({
  ok: false,
  status,
  error: { code, message: "dal server" },
});
const detail = (over = {}, activity = [auditRow()]) =>
  ok({ tenant: tenantDetail({ createdAt: "2026-10-21T10:00:00Z", ...over }), activity });
const mount = () => render(createElement(VenueDetail, { id: DEMO_TENANT_ID }));
const count = (path: string) => calls.filter((c) => c.path === path).length;
const h2s = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

beforeEach(() => {
  calls.length = 0;
  replies = {};
  apiJson.mockClear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
  Object.defineProperty(window, "location", {
    value: { assign: vi.fn(), reload: vi.fn(), replace: vi.fn(), pathname: "/", search: "" },
    configurable: true,
  });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
});

describe("the venue detail: header", () => {
  it("reads GET /api/platform/tenants/<id>, and shows the BackLink «Locali» to / and the h1 with the name", async () => {
    replies[PATH] = [detail()];
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "Osteria Demo A" })).toBeTruthy();
    expect(calls).toEqual([{ path: PATH, method: undefined }]);
    const back = screen.getByRole("link", { name: "Locali" });
    expect(back.getAttribute("href")).toBe("/");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("reads once under StrictMode", async () => {
    replies[PATH] = [detail()];
    render(createElement(StrictMode, null, createElement(VenueDetail, { id: DEMO_TENANT_ID })));
    await screen.findByRole("heading", { level: 1 });
    expect(count(PATH)).toBe(1);
  });

  it("the page passes the route's id to the screen", async () => {
    replies[PATH] = [detail()];
    render(await VenuePage({ params: Promise.resolve({ id: DEMO_TENANT_ID }) }));
    expect(await screen.findByRole("heading", { level: 1, name: "Osteria Demo A" })).toBeTruthy();
  });

  it("says «nessun gruppo · creato il 21 ott 2026» for a venue on its own", async () => {
    replies[PATH] = [detail()];
    mount();
    expect(await screen.findByText("nessun gruppo · creato il 21 ott 2026")).toBeTruthy();
  });

  it("names the group for a venue in one", async () => {
    replies[PATH] = [
      detail({ organisation: { id: DEMO_TENANT_ID, name: "Gruppo Demo", tenantCount: 2 } }),
    ];
    mount();
    expect(await screen.findByText("Gruppo Demo · creato il 21 ott 2026")).toBeTruthy();
  });

  it("has no action in the header: no «Entra nel locale», no primary button", async () => {
    replies[PATH] = [detail()];
    const { container } = mount();
    await screen.findByRole("heading", { level: 1 });
    expect(container.textContent).not.toContain("Entra nel locale");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("the venue detail: Salute", () => {
  it("attached: says «DigiAlto collegato» and has no Salute section", async () => {
    replies[PATH] = [detail({ digialtoAttached: true })];
    mount();
    expect(await screen.findByText("DigiAlto collegato")).toBeTruthy();
    expect(h2s()).not.toContain("Salute");
  });

  it("not attached: Salute holds only «DigiAlto non è collegato a questo locale.», with no button and no badge", async () => {
    replies[PATH] = [detail({ digialtoAttached: false })];
    const { container } = mount();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("DigiAlto collegato")).toBeNull();
    const section = screen.getByRole("heading", { level: 2, name: "Salute" }).closest("section")!;
    expect(section.textContent).toBe("SaluteDigiAlto non è collegato a questo locale.");
    expect(within(section).queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-tone]")).toBeNull();
  });
});

describe("the venue detail: Utilizzo", () => {
  it("shows Persone as «1 titolare · 1 cuoco · 2 camerieri · DigiAlto» when attached", async () => {
    replies[PATH] = [detail({ digialtoAttached: true })];
    mount();
    await screen.findByRole("heading", { level: 1 });
    const section = screen.getByRole("heading", { level: 2, name: "Utilizzo" }).closest("section")!;
    expect(within(section).getByText("Persone")).toBeTruthy();
    expect(within(section).getByText("1 titolare · 1 cuoco · 2 camerieri · DigiAlto")).toBeTruthy();
  });

  it("leaves out DigiAlto when it is not attached, and says «nessuno» for an empty venue", async () => {
    replies[PATH] = [
      detail({ members: { owner: 0, admin: 0, chef: 0, waiter: 0 }, digialtoAttached: false }),
    ];
    mount();
    expect(await screen.findByText("nessuno")).toBeTruthy();
  });
});

describe("the venue detail: Attività di DigiAlto", () => {
  it("shows the time, the sentence and the raw code in small text", async () => {
    replies[PATH] = [
      detail({}, [
        auditRow({
          at: "2026-11-14T08:40:00Z",
          action: "console.tenant_opened",
          origin: "console",
        }),
      ]),
    ];
    mount();
    await screen.findByRole("heading", { level: 1 });
    const section = screen
      .getByRole("heading", { level: 2, name: "Attività di DigiAlto" })
      .closest("section")!;
    const row = within(section).getAllByRole("listitem")[0]!;
    expect(within(row).getByText("14 nov 2026, 09:40")).toBeTruthy();
    expect(within(row).getByText("Locale aperto dalla console")).toBeTruthy();
    const code = within(row).getByText("codice: console.tenant_opened");
    expect(code.className).toContain("text-sm");
  });

  it("an action with no sentence shows its code", async () => {
    replies[PATH] = [detail({}, [auditRow({ action: "future.thing" as never, id: 9 })])];
    mount();
    await screen.findByRole("heading", { level: 1 });
    const row = screen.getAllByRole("listitem")[0]!;
    expect(within(row).getAllByText(/future\.thing/).length).toBeGreaterThanOrEqual(1);
    expect(within(row).getByText("codice: future.thing")).toBeTruthy();
  });

  it("says so when there is none", async () => {
    replies[PATH] = [detail({}, [])];
    mount();
    expect(await screen.findByText("Nessuna attività di DigiAlto.")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });

  it("«Vedi tutto nel registro ›» goes to /registro?locale=<id>", async () => {
    replies[PATH] = [detail()];
    mount();
    const link = await screen.findByRole("link", { name: "Vedi tutto nel registro ›" });
    expect(link.getAttribute("href")).toBe(`/registro?locale=${DEMO_TENANT_ID}`);
  });
});

describe("the venue detail: Impostazioni and order", () => {
  it("shows the name, the time zone and a dash for no booking slug", async () => {
    replies[PATH] = [detail({ timeZone: "Europe/Rome", bookingSlug: null })];
    mount();
    await screen.findByRole("heading", { level: 1 });
    const section = screen
      .getByRole("heading", { level: 2, name: "Impostazioni" })
      .closest("section")!;
    expect(section.textContent).toBe(
      "ImpostazioniNome del localeOsteria Demo AFuso orarioEurope/RomePagina prenotazioni—",
    );
  });

  it("shows the booking slug when there is one", async () => {
    replies[PATH] = [detail({ bookingSlug: "demo-a" })];
    mount();
    expect(await screen.findByText("demo-a")).toBeTruthy();
  });

  it("orders the sections Salute, Utilizzo, Attività, Impostazioni (the phone order)", async () => {
    replies[PATH] = [detail({ digialtoAttached: false })];
    mount();
    await screen.findByRole("heading", { level: 1 });
    expect(h2s()).toEqual(["Salute", "Utilizzo", "Attività di DigiAlto", "Impostazioni"]);
  });

  it("is a two-column grid from lg, settings on the left", async () => {
    replies[PATH] = [detail()];
    mount();
    await screen.findByRole("heading", { level: 1 });
    const settings = screen.getByRole("heading", { name: "Impostazioni" }).closest("section")!;
    expect(settings.className).toContain("lg:col-start-1");
    expect(settings.parentElement!.className).toContain("lg:grid-cols-");
  });

  it("holds no e-mail address and no staff name", async () => {
    replies[PATH] = [detail()];
    const { container } = mount();
    await screen.findByRole("heading", { level: 1 });
    expect(container.innerHTML).not.toContain("@");
  });
});

describe("the venue detail: states", () => {
  it("shows «Caricamento…» while the read is open", () => {
    replies[PATH] = ["pending"];
    mount();
    expect(screen.getByText("Caricamento…")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it.each(["tenant_not_found", "not_found"])("404 %s says «Locale non trovato.»", async (code) => {
    replies[PATH] = [fail(404, code)];
    mount();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Locale non trovato." }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
    expect(screen.getByRole("link", { name: "Locali" }).getAttribute("href")).toBe("/");
  });

  it("another failure shows «Non riesco a leggere il locale.» and «Riprova» reads again, with exactly one h1", async () => {
    replies[PATH] = [fail(400, "invalid_request"), detail()];
    mount();
    expect(await screen.findByText("Non riesco a leggere il locale.")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Osteria Demo A" })).toBeTruthy();
    expect(count(PATH)).toBe(2);
  });

  it("«Riprova» after console_unavailable posts /api/platform/console again", async () => {
    sessionStorage.setItem("costi.console.switching", "1");
    replies[PATH] = [fail(409, "console_selection_required")];
    mount();
    expect(await screen.findByText("La console non risponde. Riprova tra poco.")).toBeTruthy();
    expect(count(MODE)).toBe(0);
    replies[PATH] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await waitFor(() => expect(count(MODE)).toBe(1));
  });

  it("keeps «Caricamento…» and no error while the page is being left", async () => {
    replies[PATH] = [fail(409, "console_selection_required")];
    replies[MODE] = [ok({ mode: "console" })];
    mount();
    await waitFor(() => expect(count(MODE)).toBe(1));
    expect(screen.getByText("Caricamento…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
