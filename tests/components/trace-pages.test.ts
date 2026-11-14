// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import {
  BATCH_CHEF,
  BATCH_ID,
  BATCH_OWNER,
  BATCH_ROOT,
  CAPTURE,
  CHILD_ID,
  FARINA,
  INVOICE_ID,
  LINE_CHEF,
  LINE_DRAFT,
  LINE_ID,
  LINE_OWNER,
  LINE_SEARCH,
  LOT_CHEF,
  LOT_GAPS,
  LOT_ID,
  LOT_OWNER,
  LOT_SEARCH,
  MENU_LASAGNE,
  SUPPLIER_1,
} from "./trace-fixtures";

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Reply => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, message = "msg"): Reply => ({
  ok: false,
  status,
  error: { code, message },
});

let routes: Record<string, (path: string) => Reply> = {};
const calls: string[] = [];
const apiJson = vi.fn((path: string) => {
  calls.push(path);
  const bare = path.split("?")[0]!;
  const key = Object.keys(routes).find(
    (route) => bare === route || (route.endsWith("/") && path.startsWith(route)),
  );
  return Promise.resolve(key ? routes[key]!(path) : fail(404, "not_found"));
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import TracePage from "@/app/(owner)/tracciabilita/page";
import LotPage from "@/app/(owner)/tracciabilita/lotto/[id]/page";
import BatchTracePage from "@/app/(owner)/tracciabilita/produzione/[id]/page";
import LineTracePage from "@/app/(owner)/tracciabilita/piatto/[lineId]/page";

const ME = (role: string) =>
  ok({
    user: { id: "u", displayName: "Utente Demo", role },
    tenant: { id: "t", name: "Osteria Demo" },
  });
const LISTS = {
  "/api/ingredients": () =>
    ok({ ingredients: [{ id: FARINA, name: "Farina Demo", isActive: true }] }),
  "/api/suppliers": () =>
    ok({ suppliers: [{ id: SUPPLIER_1, name: "Fornitore Demo 1", isActive: true }] }),
  "/api/menu/items": () =>
    ok({ items: [{ id: MENU_LASAGNE, name: "Lasagne Demo", active: true }] }),
};

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
  calls.length = 0;
  routes = { "/api/me": () => ME("owner"), ...LISTS };
  window.history.replaceState(null, "", "/tracciabilita");
});
afterEach(cleanup);

async function renderParam(page: (props: { params: Promise<never> }) => unknown, params: object) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      createElement(
        Suspense,
        { fallback: null },
        createElement(page as never, { params: Promise.resolve(params) }),
      ),
    );
  });
  return view;
}
const renderSearch = async () => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(createElement(TracePage));
  });
  return view;
};
/** The dt/dd pairs of the page: label to value, with no-break spaces read as plain spaces. */
const pairs = (view: ReturnType<typeof render>) =>
  Object.fromEntries(
    [...view.container.querySelectorAll("dt")].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent?.replace(/\u00a0/g, " "),
    ]),
  );
const text = (view: ReturnType<typeof render>) => view.container.textContent ?? "";

describe("lot page", () => {
  it("starts with the back link, then the product name, and states what the lot was", async () => {
    routes["/api/trace/lots/"] = () => ok(LOT_OWNER);
    const view = await renderParam(LotPage as never, { id: LOT_ID });
    await screen.findByRole("heading", { level: 1, name: "Farina Demo" });
    const first = view.container.querySelector("a")!;
    expect(first.getAttribute("href")).toBe("/tracciabilita");
    expect(first.textContent).toContain("Torna alla ricerca");
    expect(apiJson).toHaveBeenCalledWith(`/api/trace/lots/${LOT_ID}`);
    const body = text(view);
    for (const expected of [
      "L-2311-A",
      "Fornitore Demo 1",
      "13 nov",
      "20 nov",
      "Magazzino",
      "FD-00 · Farina 00 25kg",
    ]) {
      expect(body).toContain(expected);
    }
    expect(body).toContain("Articolo");
    const invoice = screen.getByRole("link", { name: /Fattura n\. 418 del 13 nov/ });
    expect(invoice.getAttribute("href")).toBe(`/fatture/${INVOICE_ID}`);
  });

  it("says where it went in the lot's unit, net of reversals", async () => {
    routes["/api/trace/lots/"] = () => ok(LOT_OWNER);
    const view = await renderParam(LotPage as never, { id: LOT_ID });
    await screen.findByText("Dove è andato");
    expect(pairs(view)).toMatchObject({
      "In produzione": "18 kg",
      "Nei piatti": "2 kg",
      Scartato: "0,5 kg",
      Conteggi: "\u22120,5 kg",
      "Ancora in magazzino": "4 kg",
    });
  });

  it("lists the production batches as links, the split child with 'Diviso da', and the plates per day", async () => {
    routes["/api/trace/lots/"] = () => ok(LOT_OWNER);
    const view = await renderParam(LotPage as never, { id: LOT_ID });
    await screen.findByText("Lotti di produzione (2)");
    const links = [...view.container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain(`/tracciabilita/produzione/${BATCH_ID}`);
    expect(links).toContain(`/tracciabilita/produzione/${CHILD_ID}`);
    const body = text(view);
    expect(body).toContain("Ragù Demo · P-1114-02");
    expect(body).toContain("6 kg da questo lotto");
    expect(body).toContain("40 porz.");
    expect(body).toContain("Diviso da P-1114-02");
    expect(body).toContain("14 nov · Lasagne Demo · 14 piatti (14 porz.) · 12:40–14:55");
    expect(body).toContain("senza preparazione");
    expect(body).toContain("Annullati dopo l'invio");
    expect(body).toContain("2 piatti (2 porz.)");
  });

  it("says 'none' in the two main sections and shows a gap banner for a lot with no code", async () => {
    routes["/api/trace/lots/"] = () => ok(LOT_GAPS);
    const view = await renderParam(LotPage as never, { id: LOT_ID });
    await screen.findByText("Nessuna produzione con questo lotto.");
    const body = text(view);
    expect(body).toContain("Nessun piatto servito con questo lotto.");
    expect(body).toContain("Lotto senza codice");
    expect(body).toContain("Il fornitore non ha indicato il lotto per questa consegna.");
    expect(body).toContain("2 produzioni di Farina Demo");
    expect(body).toContain("Da verificare a mano.");
    expect(view.container.querySelector('[role="status"]')).not.toBeNull();
    expect(body).not.toContain("Annullati dopo l'invio");
  });

  it("shows no gap banner when nothing is missing", async () => {
    routes["/api/trace/lots/"] = () => ok(LOT_OWNER);
    const view = await renderParam(LotPage as never, { id: LOT_ID });
    await screen.findByText("Dove è andato");
    expect(text(view)).not.toContain("Alcuni dati mancano");
  });

  it("shows the chef neither the article nor an invoice link", async () => {
    routes["/api/me"] = () => ME("chef");
    routes["/api/trace/lots/"] = () => ok(LOT_CHEF);
    const view = await renderParam(LotPage as never, { id: LOT_ID });
    await screen.findByText("Dove è andato");
    expect(text(view)).not.toContain("Articolo");
    expect(text(view)).not.toContain("Fattura");
    expect(view.container.querySelector('a[href^="/fatture"]')).toBeNull();
    expect(text(view)).not.toContain("€");
  });

  it("says a missing lot is not found and a forbidden role is not allowed", async () => {
    routes["/api/trace/lots/"] = () => fail(404, "not_found");
    await renderParam(LotPage as never, { id: LOT_ID });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Elemento non trovato.");
    cleanup();
    routes["/api/trace/lots/"] = () => fail(403, "forbidden");
    await renderParam(LotPage as never, { id: LOT_ID });
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Questa pagina non è disponibile per il tuo ruolo.",
    );
  });
});

describe("batch trace page", () => {
  it("starts with a back link, shows where it comes from: lot rows linking to the lot, 'Senza lotto' for the shortfall", async () => {
    routes["/api/trace/batches/"] = () => ok(BATCH_OWNER);
    const view = await renderParam(BatchTracePage as never, { id: CHILD_ID });
    await screen.findByRole("heading", { level: 1, name: "Ragù Demo" });
    expect(view.container.querySelector("a")!.getAttribute("href")).toBe(`/produzione/${CHILD_ID}`);
    const body = text(view);
    expect(body).toContain("Da dove viene");
    expect(body).toContain(
      "Farina Demo · 6 kg · lotto L-2311-A · Fornitore Demo 1 · consegna 13 nov",
    );
    expect(view.container.querySelector(`a[href="/tracciabilita/lotto/${LOT_ID}"]`)).not.toBeNull();
    expect(body).toContain("Senza lotto");
    expect(body).toContain("scorta mancante al momento della produzione");
    expect(body).toContain("Fattura n. 418");
  });

  it("tells a split part that its ingredients are inherited from the parent, as a link", async () => {
    routes["/api/trace/batches/"] = () => ok(BATCH_OWNER);
    const view = await renderParam(BatchTracePage as never, { id: CHILD_ID });
    await screen.findByText("Da dove viene");
    expect(text(view)).toContain("Ingredienti ereditati dal lotto di produzione P-1114-02");
    expect(
      view.container.querySelector(`a[href="/tracciabilita/produzione/${BATCH_ID}"]`),
    ).not.toBeNull();
  });

  it("says nothing about inheritance for a root batch", async () => {
    routes["/api/trace/batches/"] = () => ok(BATCH_ROOT);
    const view = await renderParam(BatchTracePage as never, { id: BATCH_ID });
    await screen.findByText("Da dove viene");
    expect(text(view)).not.toContain("ereditati");
  });

  it("shows where the portions went, then the plates", async () => {
    routes["/api/trace/batches/"] = () => ok(BATCH_OWNER);
    const view = await renderParam(BatchTracePage as never, { id: CHILD_ID });
    await screen.findByText("Dove è andato");
    expect(pairs(view)).toMatchObject({
      Vendute: "1",
      "Pasto del personale": "1",
      Rimaste: "2",
    });
    expect(text(view)).toContain("14 nov · Lasagne Demo · 14 piatti (14 porz.)");
  });

  it("gives the chef no invoice", async () => {
    routes["/api/me"] = () => ME("chef");
    routes["/api/trace/batches/"] = () => ok(BATCH_CHEF);
    const view = await renderParam(BatchTracePage as never, { id: CHILD_ID });
    await screen.findByText("Da dove viene");
    expect(text(view)).not.toContain("Fattura");
  });
});

describe("plate trace page", () => {
  it("shows the plate, its batches and the lots and suppliers behind it", async () => {
    routes["/api/trace/lines/"] = () => ok(LINE_OWNER);
    const view = await renderParam(LineTracePage as never, { lineId: LINE_ID });
    await screen.findByRole("heading", { level: 1, name: "Lasagne Demo" });
    const body = text(view);
    expect(body).toContain("14 nov · 21:14 · Tavolo 7 · 1 porz.");
    expect(body).toContain("Preparazioni usate");
    expect(
      view.container.querySelector(`a[href="/tracciabilita/produzione/${BATCH_ID}"]`),
    ).not.toBeNull();
    expect(body).toContain("Ingredienti diretti");
    expect(body).toContain("Lotti e fornitori");
    expect(body).toContain("Fornitore Demo 1");
    expect(body).toContain("Fattura n. 418");
    expect(view.container.querySelector(`a[href="/tracciabilita/lotto/${LOT_ID}"]`)).not.toBeNull();
  });

  it("gives the chef no invoice, and a draft line says there is nothing to trace", async () => {
    routes["/api/me"] = () => ME("chef");
    routes["/api/trace/lines/"] = () => ok(LINE_CHEF);
    const view = await renderParam(LineTracePage as never, { lineId: LINE_ID });
    await screen.findByText("Lotti e fornitori");
    expect(text(view)).not.toContain("Fattura");
    cleanup();
    routes["/api/trace/lines/"] = () => ok(LINE_DRAFT);
    const draft = await renderParam(LineTracePage as never, { lineId: LINE_ID });
    await screen.findByText(
      "Questo piatto non è stato inviato in cucina: non c'è nulla da tracciare.",
    );
    expect(text(draft)).not.toContain("Preparazioni usate");
  });
});

describe("search page", () => {
  beforeEach(() => {
    routes["/api/trace/capture"] = () => ok(CAPTURE);
    routes["/api/trace/lots"] = () => ok(LOT_SEARCH);
    routes["/api/trace/lines"] = () => ok(LINE_SEARCH);
  });

  it("opens on the lot tab with the form and the capture card, and no list yet", async () => {
    const view = await renderSearch();
    await screen.findByText(/18 su 25 consegne con il lotto/);
    expect(screen.getByRole("heading", { level: 1, name: "Tracciabilità" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Da un lotto", "Da un piatto servito"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    const code = screen.getByLabelText(/^Codice lotto/) as HTMLInputElement;
    expect(code.getAttribute("autocapitalize")).toBe("characters");
    expect(text(view)).toContain("Basta l'inizio del codice.");
    expect(screen.queryByText("Risultati")).toBeNull();
    expect(calls.some((c) => c.startsWith("/api/trace/lots"))).toBe(false);
    expect(calls).toContain("/api/trace/capture");
  });

  it("lists the capture per supplier, most missing first as the API sends it", async () => {
    const view = await renderSearch();
    await screen.findByText(/18 su 25/);
    const items = [...view.container.querySelectorAll("details li")].map((li) => li.textContent);
    expect(items).toEqual(["Fornitore Demo 2 · 3 su 9", "Fornitore Demo 1 · 15 su 16"]);
  });

  it("sends exactly the typed code, lists the deliveries as links and keeps the search in the address", async () => {
    const view = await renderSearch();
    fireEvent.change(screen.getByLabelText(/^Codice lotto/), { target: { value: " L-2311 " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cerca" }));
    });
    await screen.findByText("Risultati");
    expect(calls.filter((c) => c.startsWith("/api/trace/lots"))).toEqual([
      "/api/trace/lots?q=L-2311",
    ]);
    expect(window.location.search).toBe("?lotto=L-2311");
    const link = view.container.querySelector(`a[href="/tracciabilita/lotto/${LOT_ID}"]`)!;
    expect(link.textContent).toContain("L-2311-A");
    expect(link.textContent).toContain("Scade 20 nov");
    expect(link.textContent).toContain("Farina Demo · Fornitore Demo 1 · consegna 13 nov");
    expect(text(view)).toContain("Lotto senza codice");
  });

  it("reruns a search named in the address (Back keeps the search)", async () => {
    window.history.replaceState(null, "", "/tracciabilita?lotto=L-2311");
    await renderSearch();
    await screen.findByText("Risultati");
    expect((screen.getByLabelText(/^Codice lotto/) as HTMLInputElement).value).toBe("L-2311");
    expect(calls.filter((c) => c.startsWith("/api/trace/lots"))).toEqual([
      "/api/trace/lots?q=L-2311",
    ]);
  });

  it("searches by ingredient and supplier from the disclosure", async () => {
    await renderSearch();
    fireEvent.change(screen.getByLabelText("Ingrediente"), { target: { value: FARINA } });
    fireEvent.change(screen.getByLabelText("Fornitore"), { target: { value: SUPPLIER_1 } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cerca" }));
    });
    await screen.findByText("Risultati");
    expect(calls).toContain(`/api/trace/lots?ingredientId=${FARINA}&supplierId=${SUPPLIER_1}`);
  });

  it("asks for a code, an ingredient or a supplier, with no request, and moves focus to the code field", async () => {
    await renderSearch();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cerca" }));
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Scrivi un codice lotto, o scegli un ingrediente o un fornitore.",
    );
    expect(document.activeElement).toBe(screen.getByLabelText(/^Codice lotto/));
    expect(calls.some((c) => c.startsWith("/api/trace/lots"))).toBe(false);
  });

  it("says no delivery was found and offers the other filters", async () => {
    routes["/api/trace/lots"] = () => ok({ lots: [], truncated: false });
    window.history.replaceState(null, "", "/tracciabilita?lotto=ZZ");
    const view = await renderSearch();
    await screen.findByText("Nessuna consegna trovata con questo codice.");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Prova con l'ingrediente o il fornitore" }),
      );
    });
    expect(view.container.querySelector("details")!.hasAttribute("open")).toBe(true);
  });

  it("says when the list was cut", async () => {
    routes["/api/trace/lots"] = () => ok({ ...LOT_SEARCH, truncated: true });
    window.history.replaceState(null, "", "/tracciabilita?lotto=L");
    await renderSearch();
    await screen.findByText(
      "Mostro le 2 consegne più recenti. Restringi le date per vedere le altre.",
    );
  });

  it("shows a future date and a range too long in words, under the dates", async () => {
    routes["/api/trace/lots"] = () => fail(422, "date_in_future");
    window.history.replaceState(null, "", "/tracciabilita?ingrediente=" + FARINA);
    await renderSearch();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La data non può essere nel futuro.",
    );
    cleanup();
    routes["/api/trace/lots"] = () => fail(422, "range_too_long");
    await renderSearch();
    expect((await screen.findByRole("alert")).textContent).toBe("Scegli al massimo un anno.");
  });

  it("shows any other failure in the API's own words, next to the field", async () => {
    routes["/api/trace/lots"] = () =>
      fail(500, "report_unavailable", "I dati non sono disponibili.");
    window.history.replaceState(null, "", "/tracciabilita?lotto=L-2311");
    await renderSearch();
    expect((await screen.findByRole("alert")).textContent).toBe("I dati non sono disponibili.");
    expect(screen.queryByText("Risultati")).toBeNull();
  });

  it("shows a failed plate search in the API's words", async () => {
    routes["/api/trace/lines"] = () => fail(422, "date_in_future");
    window.history.replaceState(null, "", "/tracciabilita?da=piatto&giorno=1998-11-13");
    await renderSearch();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La data non può essere nel futuro.",
    );
  });

  it("shows no form to a role that may not open it", async () => {
    routes["/api/trace/capture"] = () => fail(403, "forbidden");
    const view = await renderSearch();
    await waitFor(() =>
      expect(text(view)).toContain("Questa pagina non è disponibile per il tuo ruolo."),
    );
    expect(screen.queryByLabelText("Codice lotto")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cerca" })).toBeNull();
  });

  it("opens the plate tab from the address and lists the day's plates, a voided one badged", async () => {
    window.history.replaceState(null, "", "/tracciabilita?da=piatto&giorno=1998-11-13");
    const view = await renderSearch();
    await screen.findByText("Risultati");
    expect(screen.getAllByRole("tab")[1]!.getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Giorno") as HTMLInputElement).value).toBe("1998-11-13");
    expect(calls).toContain("/api/trace/lines?date=1998-11-13");
    const rows = [...view.container.querySelectorAll("li a")];
    expect(rows[0]!.getAttribute("href")).toBe(`/tracciabilita/piatto/${LINE_ID}`);
    expect(rows[0]!.textContent).toContain("13 nov · 21:14 · Tavolo 7 · Lasagne Demo · 1 porz.");
    expect(within(rows[1] as HTMLElement).getByText("Annullato")).toBeTruthy();
  });

  it("opens the plate tab on yesterday's business day, not yesterday's calendar day, at 00:30 Rome", async () => {
    // 1998-11-15 00:30 in Rome (CET) is 1998-11-14 23:30 UTC: the business day (02:00 cut-off) is still the 14th, so yesterday is the 13th.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("1998-11-14T23:30:00.000Z"));
    try {
      routes["/api/reports/push-sell-through"] = () =>
        ok({ businessDate: "1998-11-13", pushes: [] });
      window.history.replaceState(null, "", "/tracciabilita?da=piatto");
      await renderSearch();
      await screen.findByLabelText("Giorno");
      expect((screen.getByLabelText("Giorno") as HTMLInputElement).value).toBe("1998-11-13");
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters the plate tab by dish for the owner (the chef has no dish list)", async () => {
    window.history.replaceState(null, "", "/tracciabilita?da=piatto&giorno=1998-11-13");
    await renderSearch();
    await screen.findByText("Risultati");
    fireEvent.change(await screen.findByLabelText("Piatto"), { target: { value: MENU_LASAGNE } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cerca" }));
    });
    await waitFor(() =>
      expect(calls).toContain(`/api/trace/lines?date=1998-11-13&menuItemId=${MENU_LASAGNE}`),
    );
    cleanup();
    routes["/api/me"] = () => ME("chef");
    routes["/api/menu/items"] = () => fail(403, "forbidden");
    resetMe();
    await renderSearch();
    await screen.findByText("Risultati");
    expect(screen.queryByLabelText("Piatto")).toBeNull();
  });

  it("disables the form offline and says why", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const view = await renderSearch();
    expect(text(view)).toContain("Serve la connessione per cercare.");
    expect((screen.getByRole("button", { name: "Cerca" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    vi.restoreAllMocks();
  });

  it("keeps every control at 44 px or more", async () => {
    const view = await renderSearch();
    await screen.findByText(/18 su 25/);
    for (const el of view.container.querySelectorAll("button, input, select, summary, a")) {
      expect(el.className, el.outerHTML.slice(0, 80)).toMatch(/min-h-tap|min-h-\[44px\]/);
    }
  });
});
