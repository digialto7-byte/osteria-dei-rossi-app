// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LASAGNE_ITEM,
  SELL_CHEF,
  SELL_EMPTY,
  SELL_OWNER,
  SELL_TODAY,
} from "../helpers/sell-through-data";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const fail = (status: number, code = "x", message = "msg"): Result => ({
  ok: false,
  status,
  error: { code, message },
});

let sell: (path: string) => Result;
let menu: Result;
const calls: string[] = [];
const apiJson = vi.fn((path: string): Promise<Result> => {
  calls.push(path);
  if (path.startsWith("/api/reports/push-sell-through")) return Promise.resolve(sell(path));
  if (path === "/api/menu/items") return Promise.resolve(menu);
  return Promise.resolve(fail(404, "not_found"));
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import { SellThroughPanel } from "@/app/(owner)/spingere/sell-through-panel";

beforeEach(() => {
  sell = () => ok(SELL_OWNER);
  menu = ok({ items: [{ id: LASAGNE_ITEM, priceUnit: "porzione" }] });
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const open = async () => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(createElement(SellThroughPanel));
  });
  await screen.findByRole("heading", { name: "Com'è andata" });
  return view;
};
const text = (view: ReturnType<typeof render>) =>
  (view.container.textContent ?? "").replace(/ /g, " ");

describe("Com'è andata", () => {
  it("asks with no date (the server picks yesterday) and titles the day it was given", async () => {
    const view = await open();
    expect(calls.filter((c) => c.startsWith("/api/reports/push-sell-through"))).toEqual([
      "/api/reports/push-sell-through",
    ]);
    expect(text(view)).toContain("Venerdì 13 novembre");
    expect((screen.getByLabelText("Giorno") as HTMLInputElement).value).toBe("1998-11-13");
  });

  it("writes a push as a row: dish, plates sold, window, and the owner's day price", async () => {
    const view = await open();
    const body = text(view);
    expect(body).toContain("Lasagne Demo");
    expect(body).toContain("14 piatti venduti");
    expect(body).toContain("in evidenza 11:05–02:00");
    expect(body).toContain("Prezzo del giorno 12,00 €");
    expect(view.container.querySelectorAll("li")).toHaveLength(2);
  });

  it("says, per batch due soon at the start, how many portions there were and what became of them; the percent is the API's", async () => {
    const view = await open();
    const body = text(view);
    expect(body).toContain("Ragù Demo");
    expect(body).toContain("10 porzioni in scadenza all'avvio");
    expect(body).toContain("8 vendute (80%) · 1 scartata · 1 rimasta");
    expect(body).toContain("scartate dopo: 1");
    expect(body).not.toContain("altro");
    expect(body).toContain("Nessun lotto in scadenza all'avvio della spinta.");
    expect(body).toContain("Le porzioni vendute includono altri piatti con lo stesso preparato.");
  });

  it("shows the chef no day price, and no euro at all", async () => {
    sell = () => ok(SELL_CHEF);
    const view = await open();
    expect(text(view)).not.toContain("Prezzo del giorno");
    expect(text(view)).not.toContain("€");
    expect(calls).not.toContain("/api/menu/items");
  });

  it("shows no price for a push without one, and a price per 100 g for a dish sold by weight", async () => {
    const view = await open();
    expect(text(view).match(/Prezzo del giorno/g)).toHaveLength(1);
    cleanup();
    menu = ok({ items: [{ id: LASAGNE_ITEM, priceUnit: "etto" }] });
    const weighed = await open();
    expect(text(weighed)).toMatch(
      /Prezzo del giorno 12,00 € \/ 100 g|Prezzo del giorno 12,00 € all'etto/,
    );
  });

  it("says a day with no push in words", async () => {
    sell = () => ok(SELL_EMPTY);
    const view = await open();
    expect(text(view)).toContain("Nessun piatto messo in evidenza in questo giorno.");
    expect(text(view)).not.toContain("Le porzioni vendute includono");
  });

  it("titles today 'Oggi (in corso)', says 'finora' and 'in corso', and shows 'altro' when counts moved the stock", async () => {
    sell = () => ok(SELL_TODAY);
    const view = await open();
    const body = text(view);
    expect(body).toContain("Oggi (in corso)");
    expect(body).toContain("3 piatti venduti finora");
    expect(body).toContain("in evidenza 11:05–in corso");
    expect(body).toContain("1 venduta · 0 scartate · 8 rimaste · altro: −1");
    expect(body).not.toContain("%");
  });

  it("'Giorno precedente' asks for the day before, and a picked date asks for that date", async () => {
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Giorno precedente" }));
    });
    expect(calls).toContain("/api/reports/push-sell-through?date=1998-11-12");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Giorno"), { target: { value: "1998-11-10" } });
    });
    expect(calls).toContain("/api/reports/push-sell-through?date=1998-11-10");
  });

  it("says a date in the future in the API's words, and keeps the day picker", async () => {
    await open();
    sell = () => fail(422, "date_in_future", "La data è nel futuro: scegli un giorno già passato.");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Giorno"), { target: { value: "2099-01-01" } });
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La data è nel futuro: scegli un giorno già passato.",
    );
    expect(screen.getByLabelText("Giorno")).toBeTruthy();
  });

  it("shows nothing at all to a role the API refuses", async () => {
    sell = () => fail(403, "forbidden");
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(createElement(SellThroughPanel));
    });
    expect(view.container.textContent).toBe("");
  });
});
