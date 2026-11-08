// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingTablesCard } from "@/app/(owner)/tavoli/impostazioni/booking-tables-card";
import { ReservationsCard } from "@/app/(owner)/tavoli/impostazioni/reservations-card";
import {
  NEW_GROUP_KEY,
  TableGroupsCard,
} from "@/app/(owner)/tavoli/impostazioni/table-groups-card";
import {
  draftFromSettings,
  settingsBody,
  slugPreview,
  tableBookingChanges,
} from "@/lib/reservations/settings-view";
import {
  GROUP_1,
  RESERVATION_SETTINGS,
  TABLE_1,
  TABLE_2,
  TABLE_3,
  TABLE_BOOKING,
} from "../helpers/reservations-data";

afterEach(cleanup);

type CardProps = Parameters<typeof ReservationsCard>[0];
const card = (over: Partial<CardProps> = {}) =>
  render(
    createElement(ReservationsCard, {
      settings: RESERVATION_SETTINGS,
      origin: "https://app.example.test",
      busy: false,
      error: null,
      onSave: () => undefined,
      ...over,
    }),
  );
const READY = {
  ...RESERVATION_SETTINGS,
  ready: true,
  notReady: [] as typeof RESERVATION_SETTINGS.notReady,
  publicSlug: "osteria-demo-a",
  privacy: {
    controllerName: "Osteria Demo S.r.l. (demo)",
    controllerVat: "IT00000000000",
    contactEmail: "privacy@example.com",
  },
};
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salva prenotazioni" }));

describe("ReservationsCard", () => {
  it("the switch is disabled and the checklist lists what is missing, from the reply", () => {
    card();
    expect(
      (screen.getByRole("checkbox", { name: "Accetta prenotazioni online" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    const list = screen.getByRole("list", { name: "Per attivarle manca ancora" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "L'indirizzo della pagina",
      "Il nome del titolare del trattamento",
      "L'e-mail per la privacy",
    ]);
  });

  it("a ready page has an enabled switch and no checklist", () => {
    card({ settings: READY });
    expect(
      (screen.getByRole("checkbox", { name: "Accetta prenotazioni online" }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByRole("list", { name: "Per attivarle manca ancora" })).toBeNull();
  });

  it("a page that is on stays switchable off even when not ready", () => {
    card({ settings: { ...RESERVATION_SETTINGS, enabled: true } });
    expect(
      (screen.getByRole("checkbox", { name: "Accetta prenotazioni online" }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
  });

  it("the slug preview shows <origin>/prenota/<slug>, live as the owner types", () => {
    card({ settings: READY });
    expect(screen.getByText("https://app.example.test/prenota/osteria-demo-a")).toBeTruthy();
    type("Indirizzo della pagina", "osteria-nuova");
    expect(screen.getByText("https://app.example.test/prenota/osteria-nuova")).toBeTruthy();
  });

  it("with no slug there is a hint instead of an address", () => {
    card();
    expect(screen.queryByText(/\/prenota\//)).toBeNull();
    expect(screen.getByText("Da 3 a 40 lettere minuscole, numeri e trattini.")).toBeTruthy();
  });

  it("shows the per-service rows from the reply (Pranzo, Cena) with their booking times", () => {
    card();
    expect(field("Pranzo: primo orario").value).toBe("12:00");
    expect(field("Pranzo: ultimo orario").value).toBe("14:00");
    expect(field("Cena: primo orario").value).toBe("19:30");
    expect(field("Cena: ultimo orario").value).toBe("22:00");
    expect(
      (screen.getByRole("checkbox", { name: "Cena: prenotabile online" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(field("Cena: coperti per orario").value).toBe("");
  });

  it("shows the venue's own VAT number read-only, and the fixed numbers from the reply", () => {
    card({ settings: READY });
    expect(screen.getByText("Partita IVA: IT00000000000")).toBeTruthy();
    expect(field("Permanenza (minuti)").value).toBe("120");
    expect(field("Giorni prenotabili in anticipo").value).toBe("60");
    expect(
      (screen.getByLabelText("Intervallo tra gli orari (minuti)") as HTMLSelectElement).value,
    ).toBe("15");
  });

  it("saving sends exactly the edited body and nothing else", () => {
    const onSave = vi.fn();
    card({ onSave });
    type("Indirizzo della pagina", "osteria-demo-a");
    type("Permanenza (minuti)", "90");
    type("Titolare del trattamento (nome legale)", "Osteria Demo S.r.l. (demo)");
    save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      publicSlug: "osteria-demo-a",
      stayMinutes: 90,
      privacyControllerName: "Osteria Demo S.r.l. (demo)",
    });
  });

  it("with no edit there is nothing to send", () => {
    const onSave = vi.fn();
    card({ onSave });
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Nessuna modifica da salvare.")).toBeTruthy();
  });

  it("switching on a ready page sends enabled: true alone", () => {
    const onSave = vi.fn();
    card({ settings: READY, onSave });
    fireEvent.click(screen.getByRole("checkbox", { name: "Accetta prenotazioni online" }));
    save();
    expect(onSave).toHaveBeenCalledWith({ enabled: true });
  });

  it("closed weekdays and dates are sent as sorted lists", () => {
    const onSave = vi.fn();
    card({ onSave });
    fireEvent.click(screen.getByRole("checkbox", { name: "Venerdì" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Lunedì" }));
    type("Nuova data di chiusura", "2026-12-25");
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi data" }));
    type("Nuova data di chiusura", "2026-12-08");
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi data" }));
    save();
    expect(onSave).toHaveBeenCalledWith({
      closedWeekdays: [1, 5],
      closedDates: ["2026-12-08", "2026-12-25"],
    });
  });

  it("a closed date can be taken out again", () => {
    const onSave = vi.fn();
    card({ settings: { ...RESERVATION_SETTINGS, closedDates: ["2026-12-25"] }, onSave });
    fireEvent.click(screen.getByRole("button", { name: "Togli 2026-12-25" }));
    save();
    expect(onSave).toHaveBeenCalledWith({ closedDates: [] });
  });

  it("a service edit sends the whole services list with all seven keys per row", () => {
    const onSave = vi.fn();
    card({ onSave });
    type("Cena: coperti per orario", "12");
    save();
    const body = onSave.mock.calls[0]![0] as { services: Record<string, unknown>[] };
    expect(Object.keys(body)).toEqual(["services"]);
    expect(body.services).toHaveLength(2);
    expect(body.services[1]).toEqual({
      key: "cena",
      online: true,
      firstSeating: "19:30",
      lastSeating: "22:00",
      coversPerSlot: 12,
      reservationsPerSlot: null,
      coversPerService: null,
    });
    expect(Object.keys(body.services[0]!).sort()).toEqual([
      "coversPerService",
      "coversPerSlot",
      "firstSeating",
      "key",
      "lastSeating",
      "online",
      "reservationsPerSlot",
    ]);
  });

  it("a service with only one seating time, or first after last, is refused on the card", () => {
    const onSave = vi.fn();
    card({ onSave });
    type("Cena: ultimo orario", "");
    save();
    expect(screen.getByText("Gli orari di prenotazione dei servizi non sono validi.")).toBeTruthy();
    type("Cena: ultimo orario", "19:00");
    save();
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([
    ["Permanenza (minuti)", "29", "La permanenza va da 30 a 360 minuti."],
    ["Permanenza (minuti)", "361", "La permanenza va da 30 a 360 minuti."],
    ["Permanenza (minuti)", "abc", "La permanenza va da 30 a 360 minuti."],
    ["Preavviso minimo (minuti)", "2881", "Il preavviso va da 0 a 2.880 minuti."],
    ["Giorni prenotabili in anticipo", "0", "Si può prenotare da 1 a 365 giorni in anticipo."],
    ["Persone al massimo online", "41", "Le persone per prenotazione online vanno da 1 a 40."],
    [
      "Giorni di conservazione dei dati clienti",
      "366",
      "I dati dei clienti si conservano da 1 a 365 giorni.",
    ],
    [
      "Indirizzo della pagina",
      "A",
      "L'indirizzo usa da 3 a 40 lettere minuscole, numeri e trattini.",
    ],
    [
      "Telefono del locale",
      "12",
      "Il telefono del locale ha da 6 a 20 cifre e può iniziare con +.",
    ],
    ["E-mail per la privacy", "privacy", "L'e-mail per la privacy non è valida."],
  ])("%s = %s is refused with no request", (label, value, message) => {
    const onSave = vi.fn();
    card({ onSave });
    type(label, value);
    save();
    expect(screen.getByText(message)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("the bounds themselves pass", () => {
    const onSave = vi.fn();
    card({ onSave });
    type("Permanenza (minuti)", "30");
    type("Preavviso minimo (minuti)", "0");
    type("Persone al massimo online", "40");
    save();
    expect(onSave).toHaveBeenCalledWith({ stayMinutes: 30, leadMinutes: 0, maxPartyOnline: 40 });
  });

  it("a server 422 shows its message in an aria-live region", () => {
    card({ error: "Mancano ancora: indirizzo della pagina." });
    const live = screen.getByText("Mancano ancora: indirizzo della pagina.").closest("[aria-live]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
  });

  it("clearing the slug sends null; an untouched empty slug sends nothing", () => {
    const onSave = vi.fn();
    card({ settings: READY, onSave });
    type("Indirizzo della pagina", "");
    save();
    expect(onSave).toHaveBeenCalledWith({ publicSlug: null });
  });

  it("every control is at least 44 px tall by class (the house min-h-tap) and the button is disabled while busy", () => {
    const { container } = card({ busy: true });
    expect(
      (screen.getByRole("button", { name: "Salva prenotazioni" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    for (const input of container.querySelectorAll("input:not([type=checkbox]), select")) {
      expect(input.className, input.getAttribute("name") ?? "").toContain("min-h-tap");
    }
  });

  it("carries no inline style and no € or cost word", () => {
    const { container } = card({ settings: READY });
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.textContent).not.toMatch(/€|costo|prezzo|margine/i);
  });
});

describe("settings view helpers", () => {
  it("settingsBody of an untouched draft is empty", () => {
    expect(settingsBody(READY, draftFromSettings(READY))).toEqual({ ok: true, body: {} });
  });

  it("slugPreview is null for a blank or malformed slug", () => {
    expect(slugPreview("https://x.test", "")).toBeNull();
    expect(slugPreview("https://x.test", "Bad Slug")).toBeNull();
    expect(slugPreview("https://x.test", "osteria-demo-a")).toBe(
      "https://x.test/prenota/osteria-demo-a",
    );
  });

  it("tableBookingChanges lists only the tables that differ from the reply", () => {
    const draft = TABLE_BOOKING.tables.map((row) => ({
      tableId: row.tableId,
      bookable: row.bookable,
      seats: row.seats === null ? "" : String(row.seats),
    }));
    expect(tableBookingChanges(TABLE_BOOKING, draft)).toEqual({ ok: true, tables: [] });
    draft[2] = { tableId: TABLE_3, bookable: true, seats: "6" };
    expect(tableBookingChanges(TABLE_BOOKING, draft)).toEqual({
      ok: true,
      tables: [{ tableId: TABLE_3, bookable: true, seats: 6 }],
    });
    draft[2] = { tableId: TABLE_3, bookable: true, seats: "0" };
    expect(tableBookingChanges(TABLE_BOOKING, draft)).toEqual({ ok: false });
    draft[2] = { tableId: TABLE_3, bookable: true, seats: "41" };
    expect(tableBookingChanges(TABLE_BOOKING, draft)).toEqual({ ok: false });
    draft[2] = { tableId: TABLE_3, bookable: false, seats: "" };
    expect(tableBookingChanges(TABLE_BOOKING, draft)).toEqual({ ok: true, tables: [] });
  });
});

describe("BookingTablesCard", () => {
  type Props = Parameters<typeof BookingTablesCard>[0];
  const draw = (over: Partial<Props> = {}) =>
    render(
      createElement(BookingTablesCard, {
        booking: TABLE_BOOKING,
        busy: false,
        error: null,
        onSave: () => undefined,
        ...over,
      }),
    );

  it("lists every table of the reply in order with its switch and seats", () => {
    draw();
    expect(
      (screen.getByRole("checkbox", { name: "Tavolo 1 (demo): prenotabile" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(field("Tavolo 1 (demo): posti").value).toBe("2");
    expect(field("Tavolo 2 (demo): posti").value).toBe("4");
    expect(
      (screen.getByRole("checkbox", { name: "Tavolo 3 (demo): prenotabile" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(field("Tavolo 3 (demo): posti").value).toBe("");
  });

  it("Posti accepts 1 to 40; the save sends only the changed tables", () => {
    const onSave = vi.fn();
    draw({ onSave });
    type("Tavolo 3 (demo): posti", "40");
    fireEvent.click(screen.getByRole("checkbox", { name: "Tavolo 3 (demo): prenotabile" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva tavoli prenotabili" }));
    expect(onSave).toHaveBeenCalledWith({
      tables: [{ tableId: TABLE_3, bookable: true, seats: 40 }],
    });
  });

  it.each(["0", "41", "x", "2.5"])("Posti %s is refused with no request", (value) => {
    const onSave = vi.fn();
    draw({ onSave });
    type("Tavolo 1 (demo): posti", value);
    fireEvent.click(screen.getByRole("button", { name: "Salva tavoli prenotabili" }));
    expect(screen.getByText("I posti di un tavolo vanno da 1 a 40.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("an empty seats field sends null", () => {
    const onSave = vi.fn();
    draw({ onSave });
    type("Tavolo 2 (demo): posti", "");
    fireEvent.click(screen.getByRole("button", { name: "Salva tavoli prenotabili" }));
    expect(onSave).toHaveBeenCalledWith({
      tables: [{ tableId: TABLE_2, bookable: true, seats: null }],
    });
  });

  it("with nothing changed it says so and sends nothing", () => {
    const onSave = vi.fn();
    draw({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Salva tavoli prenotabili" }));
    expect(screen.getByText("Nessuna modifica da salvare.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("with no table there is a line saying so", () => {
    draw({ booking: { ...TABLE_BOOKING, tables: [] } });
    expect(screen.getByText("Nessun tavolo attivo.")).toBeTruthy();
  });
});

describe("TableGroupsCard", () => {
  type Props = Parameters<typeof TableGroupsCard>[0];
  const draw = (over: Partial<Props> = {}) =>
    render(
      createElement(TableGroupsCard, {
        booking: TABLE_BOOKING,
        busyKey: null,
        errors: {},
        onCreate: () => undefined,
        onDeactivate: () => undefined,
        ...over,
      }),
    );

  it("lists the active groups with their seats and the names of their tables", () => {
    draw();
    expect(
      screen.getByText("Tavoli 1+2 · 6 posti · Tavolo 1 (demo), Tavolo 2 (demo)"),
    ).toBeTruthy();
  });

  it("Disattiva sends the group's id", () => {
    const onDeactivate = vi.fn();
    draw({ onDeactivate });
    fireEvent.click(screen.getByRole("button", { name: "Disattiva il gruppo Tavoli 1+2" }));
    expect(onDeactivate).toHaveBeenCalledWith(GROUP_1);
  });

  it("Nuovo gruppo sends { name, seats, tableIds }", () => {
    const onCreate = vi.fn();
    draw({ onCreate });
    type("Nome del gruppo", "  Tavoli 2+3 ");
    type("Posti del gruppo", "8");
    fireEvent.click(screen.getByRole("checkbox", { name: "Tavolo 2 (demo)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tavolo 3 (demo)" }));
    fireEvent.click(screen.getByRole("button", { name: "Crea gruppo" }));
    expect(onCreate).toHaveBeenCalledWith({
      name: "Tavoli 2+3",
      seats: 8,
      tableIds: [TABLE_2, TABLE_3],
    });
  });

  it.each([
    ["no name", "", "4", [TABLE_1, TABLE_2], "Il nome del gruppo ha da 1 a 40 caratteri."],
    ["seats 1", "G", "1", [TABLE_1, TABLE_2], "I posti del gruppo vanno da 2 a 99."],
    ["seats 100", "G", "100", [TABLE_1, TABLE_2], "I posti del gruppo vanno da 2 a 99."],
    ["one table", "G", "4", [TABLE_1], "Scegli da 2 a 8 tavoli diversi e attivi."],
  ])("%s is refused with no request", (_label, name, seats, ids, message) => {
    const onCreate = vi.fn();
    draw({ onCreate });
    type("Nome del gruppo", name);
    type("Posti del gruppo", seats);
    for (const id of ids) {
      const table = TABLE_BOOKING.tables.find((x) => x.tableId === id)!;
      fireEvent.click(screen.getByRole("checkbox", { name: table.name }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Crea gruppo" }));
    expect(screen.getByText(message)).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("the server's message for a new group and for a group row shows in aria-live regions", () => {
    draw({
      errors: {
        [NEW_GROUP_KEY]: "Esiste già un gruppo attivo con questo nome.",
        [GROUP_1]: "Gruppo di tavoli non trovato.",
      },
    });
    for (const text of [
      "Esiste già un gruppo attivo con questo nome.",
      "Gruppo di tavoli non trovato.",
    ]) {
      expect(screen.getByText(text).closest("[aria-live]")?.getAttribute("aria-live")).toBe(
        "polite",
      );
    }
  });

  it("with no group there is a line saying so", () => {
    draw({ booking: { ...TABLE_BOOKING, groups: [] } });
    expect(screen.getByText("Nessun gruppo di tavoli.")).toBeTruthy();
  });
});
