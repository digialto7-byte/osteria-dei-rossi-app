import { describe, expect, it } from "vitest";
import {
  closedLabel,
  closedSectionLabel,
  doneCountLabel,
  kitchenWriteBlock,
  lineAccessibleName,
  markIntent,
  remainingLabel,
  ticketMarkBody,
  undoFor,
} from "@/lib/kitchen/kitchen-done";
import { KITCHEN_TAP_GUARD_MS, KITCHEN_UNDO_MS } from "@/server/kitchen/constants";
import { markTicketBody } from "@/server/kitchen/schemas";
import { KITCHEN_TICKETS, KIDS } from "../../helpers/kitchen-data";

const [stew, soup] = KITCHEN_TICKETS.tickets;
const [autoClosed, tapClosed] = KITCHEN_TICKETS.closedTickets;
const openLine = stew!.lines[0]!;
const doneLine = { ...openLine, done: true };
const voidedLine = stew!.lines[1]!;

describe("constants (M19b)", () => {
  it("the tap guard is 600 ms and the undo notice stays 8 s", () => {
    expect(KITCHEN_TAP_GUARD_MS).toBe(600);
    expect(KITCHEN_UNDO_MS).toBe(8_000);
  });
});

describe("markIntent", () => {
  const idle = { pending: false, lastChangeAt: null, now: 10_000 };

  it("asks for done on an open line and for not done on a done one", () => {
    expect(markIntent(openLine, idle)).toEqual({ done: true });
    expect(markIntent(doneLine, idle)).toEqual({ done: false });
  });

  it("asks for nothing while a request is pending", () => {
    expect(markIntent(openLine, { ...idle, pending: true })).toBeNull();
  });

  it("ignores a tap 599 ms after the last change and accepts one at 600 ms", () => {
    const base = { pending: false, lastChangeAt: 10_000 };
    expect(markIntent(openLine, { ...base, now: 10_000 + KITCHEN_TAP_GUARD_MS - 1 })).toBeNull();
    expect(markIntent(openLine, { ...base, now: 10_000 + KITCHEN_TAP_GUARD_MS })).toEqual({
      done: true,
    });
  });

  it("asks for nothing on a voided line, even if it is flagged done", () => {
    expect(markIntent(voidedLine, idle)).toBeNull();
    expect(markIntent({ ...voidedLine, done: true }, idle)).toBeNull();
  });
});

describe("ticketMarkBody", () => {
  it("builds the five fields from the comanda, for each of two comande", () => {
    expect(ticketMarkBody(stew!, true)).toEqual({
      sessionId: KIDS.session,
      firedAt: "2026-11-04T19:31:00.000000Z",
      course: "secondi",
      segue: false,
      closed: true,
    });
    expect(ticketMarkBody(soup!, false)).toEqual({
      sessionId: KIDS.session2,
      firedAt: "2026-11-04T19:40:00.000000Z",
      course: "primi",
      segue: true,
      closed: false,
    });
  });

  it("is accepted by the API schema", () => {
    expect(markTicketBody.safeParse(ticketMarkBody(stew!, true)).success).toBe(true);
    expect(markTicketBody.safeParse(ticketMarkBody(soup!, false)).success).toBe(true);
  });
});

describe("doneCountLabel and remainingLabel", () => {
  it("say 2 di 5 fatti and Da fare: 7", () => {
    expect(doneCountLabel(2, 5)).toBe("2 di 5 fatti");
    expect(doneCountLabel(2, 5, "en")).toBe("2 of 5 done");
    expect(remainingLabel(7)).toBe("Da fare: 7");
    expect(remainingLabel(7, "en")).toBe("To do: 7");
  });

  it("say Tutto fatto at zero", () => {
    expect(remainingLabel(0)).toBe("Tutto fatto");
    expect(remainingLabel(0, "en")).toBe("All done");
    expect(doneCountLabel(0, 0)).toBe("0 di 0 fatti");
  });
});

describe("closedLabel", () => {
  it("says who closed it by hand and when, in Europe/Rome", () => {
    expect(closedLabel(tapClosed!)).toBe("Chiusa alle 20:38 · Chef Demo");
    expect(closedLabel(tapClosed!, "en")).toBe("Closed at 20:38 · Chef Demo");
  });

  it("says Tutto fatto when it closed by itself", () => {
    expect(closedLabel(autoClosed!)).toBe("Tutto fatto alle 20:41");
    expect(closedLabel(autoClosed!, "en")).toBe("All done at 20:41");
  });

  it("follows the change from summer to winter time", () => {
    expect(closedLabel({ ...tapClosed!, closedAt: "2026-10-25T01:30:00.000000+00:00" })).toBe(
      "Chiusa alle 02:30 · Chef Demo",
    );
    expect(closedLabel({ ...tapClosed!, closedAt: "2026-10-24T23:30:00.000000+00:00" })).toBe(
      "Chiusa alle 01:30 · Chef Demo",
    );
  });

  it("is empty for a comanda that is not closed", () => {
    expect(closedLabel(stew!)).toBe("");
  });
});

describe("kitchenWriteBlock", () => {
  it("blocks offline and when the screen is stale, with the hint", () => {
    const hint = "Serve la connessione per segnare i piatti.";
    expect(kitchenWriteBlock({ online: false, stale: false })).toBe(hint);
    expect(kitchenWriteBlock({ online: true, stale: true })).toBe(hint);
    expect(kitchenWriteBlock({ online: false, stale: true })).toBe(hint);
    expect(kitchenWriteBlock({ online: false, stale: false }, "en")).toBe(
      "A connection is needed to mark dishes.",
    );
  });

  it("does not block when online and fresh", () => {
    expect(kitchenWriteBlock({ online: true, stale: false })).toBeNull();
  });
});

describe("undoFor", () => {
  it("after an auto close, undoes the last line", () => {
    const undo = undoFor({ changed: true, autoClosed: true }, openLine.id, stew!);
    expect(undo).toEqual({
      text: "Tavolo 1 (demo) · Secondi: comanda chiusa",
      path: `/api/kitchen/lines/${openLine.id}/mark`,
      body: { done: false },
    });
  });

  it("after a manual close, reopens the comanda", () => {
    const undo = undoFor({ changed: true }, null, soup!);
    expect(undo).toEqual({
      text: "Tavolo 2 (demo) · Primi: comanda chiusa",
      path: "/api/kitchen/tickets/mark",
      body: ticketMarkBody(soup!, false),
    });
  });

  it("offers nothing when nothing closed", () => {
    expect(undoFor({ changed: true, autoClosed: false }, openLine.id, stew!)).toBeNull();
    expect(undoFor({ changed: false, autoClosed: false }, openLine.id, stew!)).toBeNull();
    expect(undoFor({ changed: false }, null, soup!)).toBeNull();
  });

  it("words the notice in English", () => {
    expect(undoFor({ changed: true }, null, soup!, "en")!.text).toBe(
      "Tavolo 2 (demo) · First courses: order closed",
    );
  });
});

describe("lineAccessibleName", () => {
  it("says what a tap does", () => {
    expect(lineAccessibleName(openLine)).toBe("Segna fatto: 2 × Spezzatino con polenta (demo)");
    expect(lineAccessibleName(doneLine)).toBe("Annulla fatto: 2 × Spezzatino con polenta (demo)");
    expect(lineAccessibleName(openLine, "en")).toBe("Mark done: 2 × Spezzatino con polenta (demo)");
  });
});

describe("closedSectionLabel", () => {
  it("counts the closed comande for the toggle", () => {
    expect(closedSectionLabel(KITCHEN_TICKETS.closedTickets)).toBe("Chiuse oggi (2)");
    expect(closedSectionLabel(KITCHEN_TICKETS.closedTickets, "en")).toBe("Closed today (2)");
    expect(closedSectionLabel([autoClosed!])).toBe("Chiuse oggi (1)");
  });

  it("is null when none is closed, so the section is not shown", () => {
    expect(closedSectionLabel([])).toBeNull();
  });
});
