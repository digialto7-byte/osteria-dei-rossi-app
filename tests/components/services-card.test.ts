// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesCard } from "@/app/(owner)/tavoli/impostazioni/services-card";
import { SERVICE_PERIODS, SET_SERVICE_PERIODS } from "../helpers/services-data";

type Props = Parameters<typeof ServicesCard>[0];
const props = (over: Partial<Props> = {}): Props => ({
  services: SET_SERVICE_PERIODS,
  busy: false,
  error: null,
  onSave: () => undefined,
  ...over,
});
const draw = (over: Partial<Props> = {}) => render(createElement(ServicesCard, props(over)));
afterEach(cleanup);

describe("ServicesCard", () => {
  it("shows one row per period with its name and start, from the reply", () => {
    draw();
    const card = screen.getByRole("group", { name: "Servizi" });
    expect((within(card).getByLabelText("Nome del servizio 1") as HTMLInputElement).value).toBe(
      "Pranzo",
    );
    expect((within(card).getByLabelText("Inizio del servizio 1") as HTMLInputElement).value).toBe(
      "11:00",
    );
    expect((within(card).getByLabelText("Nome del servizio 2") as HTMLInputElement).value).toBe(
      "Aperitivo",
    );
    expect((within(card).getByLabelText("Inizio del servizio 3") as HTMLInputElement).value).toBe(
      "19:30",
    );
    expect((within(card).getByLabelText("Inizio del servizio 1") as HTMLInputElement).type).toBe(
      "time",
    );
  });

  it("shows the server's preview and the hint with the first service", () => {
    draw({ services: SERVICE_PERIODS });
    expect(screen.getByText("Pranzo 11:00–16:00 · Cena 16:00–02:00")).toBeTruthy();
    expect(
      screen.getByText(
        "Prima delle 11:00 conta come Pranzo. Le modifiche valgono per i tavoli aperti da ora in poi.",
      ),
    ).toBeTruthy();
  });

  it("says Orari predefiniti only when the reply is the default", () => {
    draw({ services: SERVICE_PERIODS });
    expect(screen.getByText("Orari predefiniti")).toBeTruthy();
    cleanup();
    draw({ services: SET_SERVICE_PERIODS });
    expect(screen.queryByText("Orari predefiniti")).toBeNull();
  });

  it("Aggiungi servizio adds an empty row that is sent with key null", () => {
    const onSave = vi.fn();
    draw({ services: SERVICE_PERIODS, onSave });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi servizio" }));
    fireEvent.change(screen.getByLabelText("Nome del servizio 3"), {
      target: { value: "Aperitivo" },
    });
    fireEvent.change(screen.getByLabelText("Inizio del servizio 3"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva servizi" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      periods: [
        { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
        { key: "cena", name: "Cena", startsAt: "16:00" },
        { key: null, name: "Aperitivo", startsAt: "18:00" },
      ],
    });
  });

  it("at six rows there is no Aggiungi servizio", () => {
    const six = {
      ...SET_SERVICE_PERIODS,
      periods: Array.from({ length: 6 }, (_, i) => ({
        key: `s_00000000${i}0`,
        name: `S${i}`,
        startsAt: `0${i + 1}:00`,
        endsAt: `0${i + 2}:00`,
      })),
    };
    draw({ services: six });
    expect(screen.queryByRole("button", { name: "Aggiungi servizio" })).toBeNull();
  });

  it("with one row there is no Rimuovi; with two each row has one", () => {
    draw({ services: { ...SERVICE_PERIODS, periods: [SERVICE_PERIODS.periods[0]!] } });
    expect(screen.queryAllByRole("button", { name: /^Rimuovi/ })).toHaveLength(0);
    cleanup();
    draw({ services: SERVICE_PERIODS });
    expect(screen.getAllByRole("button", { name: /^Rimuovi servizio/ })).toHaveLength(2);
  });

  it("Rimuovi takes the row out and the save sends the rest in screen order", () => {
    const onSave = vi.fn();
    draw({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Rimuovi servizio 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva servizi" }));
    expect(onSave).toHaveBeenCalledWith({
      periods: [
        { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
        { key: "cena", name: "Cena", startsAt: "19:30" },
      ],
    });
  });

  it("a blank name or start is refused on the card with no save", () => {
    const onSave = vi.fn();
    draw({ onSave });
    fireEvent.change(screen.getByLabelText("Nome del servizio 1"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salva servizi" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Scrivi il nome e l'ora di inizio di ogni servizio.")).toBeTruthy();
  });

  it("a server message shows in the aria-live region of the card", () => {
    draw({ error: "Due servizi non possono iniziare alla stessa ora." });
    const live = screen.getByRole("group", { name: "Servizi" }).querySelector("[aria-live]");
    expect(live?.textContent).toBe("Due servizi non possono iniziare alla stessa ora.");
  });

  it("disables everything while busy", () => {
    draw({ busy: true });
    expect(
      (screen.getByRole("button", { name: "Salva servizi" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("Nome del servizio 1") as HTMLInputElement).disabled).toBe(true);
  });

  it("every button and input is a 44 px target (min-h-tap)", () => {
    const html = renderToStaticMarkup(createElement(ServicesCard, props()));
    const controls = [...html.matchAll(/<(button|input)\b[^>]*>/g)].map((m) => m[0]);
    expect(controls.length).toBeGreaterThanOrEqual(9);
    for (const control of controls) expect(control).toContain("min-h-tap");
  });

  it("a service name is text, never markup", () => {
    draw({
      services: {
        ...SERVICE_PERIODS,
        periods: [{ ...SERVICE_PERIODS.periods[0]!, name: "<img src=x onerror=alert(1)>" }],
      },
    });
    expect(document.querySelector("img")).toBeNull();
  });
});
