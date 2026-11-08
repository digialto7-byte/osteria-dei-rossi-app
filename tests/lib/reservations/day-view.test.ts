import { describe, expect, it } from "vitest";
import {
  actionLabel,
  dateFromQuery,
  dayHeading,
  emailWord,
  headline,
  joinedLines,
  optionLabel,
  pickOf,
  rowTitle,
  statusTone,
  statusWord,
  tablesLine,
} from "@/lib/reservations/day-view";
import { RESERVATION_ACTIONS, RESERVATION_STATUSES } from "@/server/reservations/constants";
import { isMessageKey } from "@/lib/i18n";
import {
  GROUP_1,
  ROW_ACCEPTED,
  ROW_PENDING,
  SUGGESTION,
  TABLE_1,
  TABLE_2,
} from "../../helpers/reservations-data";

describe("headline", () => {
  it("words the counts of a service: bookings, covers and the ones to confirm", () => {
    expect(headline({ reservations: 2, covers: 6, pending: 1 })).toBe(
      "2 prenotazioni · 6 coperti · 1 da confermare",
    );
  });
  it("uses the singular for one, and drops the 'to confirm' part when there is none", () => {
    expect(headline({ reservations: 1, covers: 1, pending: 0 })).toBe("1 prenotazione · 1 coperto");
    expect(headline({ reservations: 0, covers: 0, pending: 0 })).toBe("0 prenotazioni · 0 coperti");
  });
  it("speaks English in the second locale", () => {
    expect(headline({ reservations: 2, covers: 6, pending: 1 }, "en")).toBe(
      "2 reservations · 6 covers · 1 to confirm",
    );
  });
});

describe("rows", () => {
  it("the title is the time, the party and the name", () => {
    expect(rowTitle(ROW_PENDING)).toBe("20:00 · 4 persone · Cliente Demo");
    expect(rowTitle({ ...ROW_PENDING, party: 1 })).toBe("20:00 · 1 persona · Cliente Demo");
  });
  it("an erased contact reads Dati cancellati", () => {
    expect(rowTitle({ ...ROW_PENDING, name: null })).toBe("20:00 · 4 persone · Dati cancellati");
  });
  it("the tables line joins the names with +; none is null", () => {
    expect(tablesLine(ROW_ACCEPTED)).toBe("Tavolo 1 (demo) + Tavolo 2 (demo)");
    expect(tablesLine(ROW_PENDING)).toBeNull();
  });
  it("joinedLines names the lead for each joined table, from the reply", () => {
    expect(joinedLines(ROW_ACCEPTED)).toEqual(["Tavolo 2 (demo): unito a Tavolo 1 (demo)"]);
    expect(joinedLines(ROW_PENDING)).toEqual([]);
  });
});

describe("words", () => {
  it("every status and action has an Italian and an English word", () => {
    for (const status of RESERVATION_STATUSES) {
      expect(isMessageKey(`reservations.status.${status}`), status).toBe(true);
      expect(statusWord(status).length).toBeGreaterThan(2);
      expect(statusWord(status, "en").length).toBeGreaterThan(2);
    }
    for (const action of RESERVATION_ACTIONS) {
      expect(isMessageKey(`reservations.action.${action}`), action).toBe(true);
    }
  });
  it("the key words of the screen", () => {
    expect(statusWord("pending")).toBe("Da confermare");
    expect(statusWord("accepted")).toBe("Confermata");
    expect(actionLabel("accept")).toBe("Accetta");
    expect(actionLabel("decline")).toBe("Rifiuta");
    expect(actionLabel("seat")).toBe("Apri tavolo");
    expect(actionLabel("split")).toBe("Separa tavoli");
    expect(actionLabel("erase")).toBe("Cancella dati cliente");
  });
  it("an unknown status gets a neutral word, never the raw code", () => {
    expect(statusWord("martian")).toBe("Stato sconosciuto");
    expect(statusTone("martian")).toBe("neutral");
  });
  it("the tones reinforce the word", () => {
    expect(statusTone("pending")).toBe("warning");
    expect(statusTone("seated")).toBe("success");
    expect(statusTone("no_show")).toBe("danger");
  });
  it("the e-mail status has a word; an unknown one has none", () => {
    expect(emailWord("sent")).toBe("E-mail inviata");
    expect(emailWord("failed")).toBe("E-mail non inviata");
    expect(emailWord("weird")).toBeNull();
    expect(emailWord(null)).toBeNull();
  });
});

describe("table options", () => {
  it("labels a single table and a group the way the sheet shows them", () => {
    expect(optionLabel(SUGGESTION.suggested!)).toBe("Tavolo 2 (demo), 4 posti");
    expect(optionLabel(SUGGESTION.alternatives[0]!)).toBe(
      "Tavoli 1+2: Tavolo 1 (demo) + Tavolo 2 (demo), 6 posti",
    );
  });
  it("a pick is exactly the body of accept", () => {
    expect(pickOf(SUGGESTION.suggested!)).toEqual({ tableIds: [TABLE_2], groupId: null });
    expect(pickOf(SUGGESTION.alternatives[0]!)).toEqual({
      tableIds: [TABLE_1, TABLE_2],
      groupId: GROUP_1,
    });
  });
});

describe("dates", () => {
  it("dateFromQuery keeps a real calendar date and drops anything else", () => {
    expect(dateFromQuery("2026-11-20")).toBe("2026-11-20");
    for (const bad of [
      null,
      "",
      "2026-13-01",
      "2026-02-30",
      "20-11-2026",
      "2026-11-20x",
      "today",
    ]) {
      expect(dateFromQuery(bad), String(bad)).toBeNull();
    }
  });
  it("dayHeading is the short weekday and the date", () => {
    expect(dayHeading("2026-11-20")).toBe("ven 20/11/2026");
  });
});
