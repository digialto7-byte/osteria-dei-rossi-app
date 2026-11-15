// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AcceptSheet } from "@/app/(owner)/prenotazioni/accept-sheet";
import { DeclineSheet } from "@/app/(owner)/prenotazioni/decline-sheet";
import { EraseSheet } from "@/app/(owner)/prenotazioni/erase-sheet";
import { MoveSheet } from "@/app/(owner)/prenotazioni/move-sheet";
import { NewReservationSheet } from "@/app/(owner)/prenotazioni/new-reservation-sheet";
import { SeatSheet } from "@/app/(owner)/prenotazioni/seat-sheet";
import type { RowView } from "@/lib/reservations/day-view";

// P2g-2, plan D18 (Q-L4 answered with the default, so V2 did not apply): the six sheets set their title with SubHeading, the house 24 px heading, instead of a hand-made
// display-font h2. Still an h2 that takes focus when the sheet opens (tabIndex -1), and a heading that breaks long words.
afterEach(cleanup);

const ROW: RowView = {
  id: "00000000-0000-4000-8000-000000000001",
  time: "20:00",
  startsAt: "2026-11-20T19:00:00Z",
  endsAt: "2026-11-20T21:00:00Z",
  businessDate: "2026-11-20",
  serviceKey: "cena",
  party: 4,
  status: "pending",
  source: "online",
  name: "Cliente Demo",
  phone: null,
  email: null,
  tables: [],
  leadTable: null,
  groupName: null,
  groupId: null,
  sessionId: null,
  actions: [],
};
const none = () => undefined;
const common = { busy: false, error: null, onCancel: none };
const SERVICES = [{ key: "cena", name: "Cena" }];

const SHEETS: [string, string, () => ReturnType<typeof createElement>][] = [
  [
    "AcceptSheet (accept)",
    "Accetta la richiesta",
    () =>
      createElement(AcceptSheet, {
        ...common,
        mode: "accept",
        row: ROW,
        suggestion: null,
        booking: null,
        loading: true,
        loaded: false,
        onSubmit: none,
      }),
  ],
  [
    "AcceptSheet (tables)",
    "Cambia tavoli",
    () =>
      createElement(AcceptSheet, {
        ...common,
        mode: "tables",
        row: ROW,
        suggestion: null,
        booking: null,
        loading: true,
        loaded: false,
        onSubmit: none,
      }),
  ],
  [
    "DeclineSheet",
    "Rifiuta la prenotazione",
    () => createElement(DeclineSheet, { ...common, row: ROW, onSubmit: none }),
  ],
  [
    "EraseSheet",
    "Cancella dati cliente",
    () => createElement(EraseSheet, { ...common, row: ROW, onConfirm: none }),
  ],
  [
    "MoveSheet",
    "Sposta la prenotazione",
    () => createElement(MoveSheet, { ...common, row: ROW, services: SERVICES, onSubmit: none }),
  ],
  [
    "NewReservationSheet",
    "Nuova prenotazione",
    () =>
      createElement(NewReservationSheet, {
        ...common,
        date: "2026-11-20",
        services: SERVICES,
        onSubmit: none,
      }),
  ],
  [
    "SeatSheet",
    "Apri tavolo",
    () =>
      createElement(SeatSheet, {
        ...common,
        row: ROW,
        sessionId: "00000000-0000-4000-8000-000000000002",
        seatChoices: [],
        onSubmit: none,
      }),
  ],
];

describe.each(SHEETS)("%s title", (_name, title, make) => {
  it("is the house SubHeading: an h2 at 24 px in the Costì display face", () => {
    render(make());
    const heading = screen.getByRole("heading", { level: 2, name: title });
    expect(heading.className).toContain("font-display");
    expect(heading.className).toContain("text-[1.5rem]");
    expect(heading.className).toContain("text-ink");
  });

  it("takes focus when the sheet opens and wraps long words", () => {
    render(make());
    const heading = screen.getByRole("heading", { level: 2, name: title });
    expect(heading.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(heading);
    expect(heading.className).toContain("[overflow-wrap:anywhere]");
  });
});
