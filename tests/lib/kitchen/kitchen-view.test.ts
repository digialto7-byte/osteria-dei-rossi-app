import { describe, expect, it } from "vitest";
import {
  asOfLabel,
  canReadKitchen,
  firedLine,
  isStale,
  ticketHeading,
  uscitaLabel,
  voidLabel,
} from "@/lib/kitchen/kitchen-view";
import { KITCHEN_STALE_MS } from "@/server/kitchen/constants";
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
  // Re-pinned on purpose by comanda-uscite (step 13; was the course label and the "A seguire" badge): the heading names the uscita.
  it("gives the table, covers, uscita and who sent it when", () => {
    expect(ticketHeading(stewTicket!)).toEqual({
      table: "Tavolo 1 (demo)",
      covers: "4 coperti",
      course: "1ª uscita",
      segueBadge: null,
      sent: "20:31 · Cameriere Demo",
    });
  });

  it("marks an addition with a badge and uses the singular for one cover", () => {
    expect(ticketHeading({ ...soupTicket!, covers: 1, addition: true })).toMatchObject({
      covers: "1 coperto",
      course: "2ª uscita",
      segueBadge: "Aggiunta",
      sent: "20:40 · Cameriere Due Demo",
    });
    expect(ticketHeading(soupTicket!).segueBadge).toBeNull();
  });

  it("names uscita 0 Subito, in both languages", () => {
    expect(uscitaLabel(0)).toBe("Subito");
    expect(uscitaLabel(3)).toBe("3ª uscita");
    expect(uscitaLabel(0, "en")).toBe("Right away");
    expect(uscitaLabel(3, "en")).toBe("Course 3");
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
