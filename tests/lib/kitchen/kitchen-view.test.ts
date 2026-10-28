import { describe, expect, it } from "vitest";
import {
  asOfLabel,
  canReadKitchen,
  firedLine,
  isStale,
  ticketHeading,
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
    });
  });

  it("writes a half portion as one half, a shared plate as to divide and a voided line with its reason", () => {
    expect(firedLine(stewTicket!.lines[1]!)).toEqual({
      text: "½ × Zuppa del giorno (demo)",
      note: null,
      shared: true,
      voided: true,
      voidText: "Stornato · Errore in cucina",
    });
  });
});
