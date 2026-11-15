import { describe, expect, it } from "vitest";
import {
  asOfLabel,
  canReadKitchen,
  firedLine,
  isStale,
  kitchenCardText,
  kitchenHomeCard,
  ticketHeading,
  voidLabel,
} from "@/lib/kitchen/kitchen-view";
import { KITCHEN_MAX_TICKETS, KITCHEN_STALE_MS } from "@/server/kitchen/constants";
import { KITCHEN_TICKETS } from "../../helpers/kitchen-data";

const [stewTicket, soupTicket] = KITCHEN_TICKETS.tickets;

describe("isStale", () => {
  const t = 1_000_000;
  it("is false up to and including 60 s, true after", () => {
    expect(KITCHEN_STALE_MS).toBe(60_000);
    expect(isStale(t, t)).toBe(false);
    expect(isStale(t, t + 60_000)).toBe(false);
    expect(isStale(t, t + 60_001)).toBe(true);
  });

  it("is false before any read has succeeded is the caller's job: a null last read is stale", () => {
    expect(isStale(null, t)).toBe(true);
  });
});

describe("asOfLabel", () => {
  it("shows the clock in Europe/Rome", () => {
    expect(asOfLabel("2026-11-04T19:31:00Z")).toBe("Aggiornato alle 20:31");
    expect(asOfLabel("2026-11-04T19:31:00Z", "en")).toBe("Updated at 20:31");
  });

  it("follows the change from summer to winter time (2026-10-25)", () => {
    expect(asOfLabel("2026-10-25T00:30:00Z")).toBe("Aggiornato alle 02:30");
    expect(asOfLabel("2026-10-25T01:30:00Z")).toBe("Aggiornato alle 02:30");
  });
});

describe("voidLabel", () => {
  it("names the reason in text, never by colour alone", () => {
    expect(voidLabel("kitchen_error")).toBe("Stornato · Errore in cucina");
    expect(voidLabel("comp", "en")).toBe("Voided · On the house");
  });
});

describe("canReadKitchen", () => {
  it("is true for owner, admin and chef, false for the waiter", () => {
    expect(canReadKitchen("owner")).toBe(true);
    expect(canReadKitchen("admin")).toBe(true);
    expect(canReadKitchen("chef")).toBe(true);
    expect(canReadKitchen("waiter")).toBe(false);
  });
});

describe("ticketHeading", () => {
  it("gives the table, covers, course and who sent it when", () => {
    expect(ticketHeading(stewTicket!)).toEqual({
      table: "Tavolo 1 (demo)",
      covers: "4 coperti",
      course: "Secondi",
      segueBadge: null,
      sent: "20:31 · Cameriere Demo",
    });
  });

  it("marks a segue ticket and uses the singular for one cover", () => {
    expect(ticketHeading({ ...soupTicket!, covers: 1 })).toMatchObject({
      covers: "1 coperto",
      course: "Primi",
      segueBadge: "A seguire",
      sent: "20:40 · Cameriere Due Demo",
    });
  });
});

describe("firedLine", () => {
  it("writes quantity and name, with the note", () => {
    expect(firedLine(stewTicket!.lines[0]!)).toEqual({
      text: "2 × Spezzatino con polenta (demo)",
      note: "senza cipolla",
      shared: false,
      voided: false,
      voidText: null,
      done: false,
    });
  });

  it("writes a half portion as one half, a shared plate as to divide and a voided line with its reason", () => {
    expect(firedLine(stewTicket!.lines[1]!)).toEqual({
      text: "½ × Zuppa del giorno (demo)",
      note: null,
      shared: true,
      voided: true,
      voidText: "Stornato · Errore in cucina",
      done: false,
    });
  });
});

describe("firedLine, done state (M19b)", () => {
  it("passes done through and is false for an open line", () => {
    expect(firedLine(stewTicket!.lines[0]!).done).toBe(false);
    expect(firedLine({ ...stewTicket!.lines[0]!, done: true }).done).toBe(true);
  });
});

describe("K1 card", () => {
  const ticketsOf = (n: number) => Array.from({ length: n }, () => stewTicket!);

  it("counts the active comande and the dishes still to make", () => {
    expect(kitchenHomeCard(KITCHEN_TICKETS)).toEqual({
      status: "ok",
      open: 2,
      remaining: 2,
      more: false,
    });
  });

  it("reads an empty kitchen as 0 open", () => {
    expect(kitchenHomeCard({ tickets: [], remaining: 0, truncated: false })).toEqual({
      status: "ok",
      open: 0,
      remaining: 0,
      more: false,
    });
  });

  it("says 'or more' only when the active list itself hit the cap", () => {
    const capped = kitchenHomeCard({
      tickets: ticketsOf(KITCHEN_MAX_TICKETS),
      remaining: 9,
      truncated: true,
    });
    expect(capped.more).toBe(true);
    // the closed list was cut, not the active one
    expect(kitchenHomeCard({ tickets: ticketsOf(3), remaining: 1, truncated: true }).more).toBe(
      false,
    );
  });

  it("words every state in Italian", () => {
    expect(kitchenCardText({ status: "ok", open: 2, remaining: 7, more: false })).toEqual({
      title: "Comande aperte · 2",
      detail: "Da fare: 7",
      action: "Apri la cucina",
    });
    expect(kitchenCardText({ status: "ok", open: 0, remaining: 0, more: false })).toMatchObject({
      title: "Nessuna comanda in cucina.",
      detail: null,
    });
    expect(kitchenCardText({ status: "ok", open: 200, remaining: 3, more: true }).title).toBe(
      "Comande aperte · 200 o più",
    );
    expect(kitchenCardText({ status: "loading" })).toMatchObject({
      title: "Comande aperte",
      detail: null,
    });
    expect(kitchenCardText({ status: "error" })).toMatchObject({
      title: "Comande aperte",
      detail: "Il numero delle comande non è disponibile.",
    });
  });

  it("words every state in English", () => {
    expect(kitchenCardText({ status: "ok", open: 2, remaining: 7, more: false }, "en")).toEqual({
      title: "Open orders · 2",
      detail: "To do: 7",
      action: "Open the kitchen",
    });
    expect(kitchenCardText({ status: "ok", open: 0, remaining: 0, more: false }, "en").title).toBe(
      "No orders in the kitchen.",
    );
    expect(kitchenCardText({ status: "ok", open: 200, remaining: 3, more: true }, "en").title).toBe(
      "Open orders · 200 or more",
    );
    expect(kitchenCardText({ status: "loading" }, "en").title).toBe("Open orders");
    expect(kitchenCardText({ status: "error" }, "en").detail).toBe(
      "The number of orders is not available.",
    );
  });

  it("never shows a euro sign or a bare placeholder", () => {
    const states = [
      { status: "loading" },
      { status: "error" },
      { status: "ok", open: 0, remaining: 0, more: false },
      { status: "ok", open: 3, remaining: 4, more: false },
      { status: "ok", open: 200, remaining: 4, more: true },
    ] as const;
    for (const locale of ["it", "en"] as const) {
      for (const s of states) {
        const { title, detail, action } = kitchenCardText(s, locale);
        for (const text of [title, detail ?? "", action]) {
          expect(text).not.toContain("€");
          expect(text).not.toContain("{");
        }
      }
    }
  });
});
