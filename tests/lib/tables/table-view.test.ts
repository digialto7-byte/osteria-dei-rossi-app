import { describe, expect, it } from "vitest";
import { UNKNOWN, type SessionHeader } from "@/lib/orders/session-header";
import type { ShownTile } from "@/lib/sync/overlay-tables";
import { IDS, shownTile, TABLES_LIST } from "../../helpers/menu-tables-data";
import {
  canConfigureTables,
  canUseTables,
  copertoLine,
  coversLine,
  headerMetaLine,
  nextCovers,
  openedLine,
  queuedOpenedLine,
  sessionMetaLine,
  statusTone,
  statusWord,
  TABLE_STATUSES,
  tileLabel,
  unsentBadge,
  unsentDishes,
} from "@/lib/tables/table-view";

describe("roles (mirror the routes)", () => {
  it("canUseTables: owner, admin and waiter; never the chef", () => {
    for (const role of ["owner", "admin", "waiter"]) expect(canUseTables(role), role).toBe(true);
    for (const role of ["chef", "", "guest"]) expect(canUseTables(role), role).toBe(false);
  });
  it("canConfigureTables: owner and admin", () => {
    for (const role of ["owner", "admin"]) expect(canConfigureTables(role), role).toBe(true);
    for (const role of ["waiter", "chef", ""]) expect(canConfigureTables(role), role).toBe(false);
  });
});

describe("statusWord and statusTone", () => {
  it("words the six statuses in Italian (joined is the reservations' V4: a table joined to a seated booking)", () => {
    expect(TABLE_STATUSES.map((s) => statusWord(s))).toEqual([
      "Libero",
      "Aperto",
      "Portate inviate",
      "Conto richiesto",
      "Chiuso",
      "Unito",
    ]);
  });
  it("words them in English too", () => {
    expect(TABLE_STATUSES.map((s) => statusWord(s, "en"))).toEqual([
      "Free",
      "Open",
      "Courses sent",
      "Bill requested",
      "Closed",
      "Joined",
    ]);
  });
  it("an unknown status gets a neutral word, never the raw code", () => {
    expect(statusWord("paid")).not.toContain("paid");
    expect(statusWord("paid")).toMatch(/[A-Za-z]{3}/);
    expect(statusTone("paid")).toBe("neutral");
  });
  it("gives each status a tone, the word carries the meaning", () => {
    expect(statusTone("free")).toBe("neutral");
    expect(statusTone("open")).toBe("success");
    expect(statusTone("courses_sent")).toBe("info");
    expect(statusTone("bill_requested")).toBe("warning");
    expect(statusTone("closed")).toBe("neutral");
    expect(statusTone("joined")).toBe("neutral");
  });
});

describe("coversLine", () => {
  it("is singular for 1 and plural otherwise", () => {
    expect(coversLine(1)).toBe("1 coperto");
    expect(coversLine(4)).toBe("4 coperti");
    expect(coversLine(99)).toBe("99 coperti");
    expect(coversLine(4, "en")).toBe("4 covers");
    expect(coversLine(1, "en")).toBe("1 cover");
  });
});

describe("openedLine", () => {
  it("shows the waiter and the Rome clock time of today's opening", () => {
    // 19:15Z on 2 November (CET, UTC+1) is 20:15 in Rome.
    expect(openedLine("Cameriere Demo", "2026-11-02T19:15:00Z", true)).toBe(
      "Cameriere Demo · 20:15",
    );
  });
  it("adds the date when the business date is not today", () => {
    // 23:30Z on 24 October (CEST, UTC+2) is 01:30 on the 25th in Rome.
    expect(openedLine("Cameriere Demo", "2026-10-24T23:30:00Z", false)).toBe(
      "Cameriere Demo · 25/10 01:30",
    );
  });
  it("keeps Rome time across the end of daylight saving time", () => {
    // 02:30Z on 25 October is already CET: 03:30.
    expect(openedLine("Cameriere Demo", "2026-10-25T02:30:00Z", true)).toBe(
      "Cameriere Demo · 03:30",
    );
  });
  it("reads the server's microsecond timestamps", () => {
    expect(openedLine("Cameriere Demo", "2026-11-02T19:15:00.123456+00:00", true)).toBe(
      "Cameriere Demo · 20:15",
    );
  });
});

describe("queuedOpenedLine (a table opened on this phone, not yet applied)", () => {
  // The day compared is the plain calendar day in Rome: the server's business-day cut-off does not apply to a phone-side tap.
  it("same Rome day as now: the clock time, then 'Apertura in coda'", () => {
    expect(
      queuedOpenedLine("Giulia", "2026-11-02T19:14:00Z", new Date("2026-11-02T21:00:00Z")),
    ).toBe("Giulia · 20:14 · Apertura in coda");
  });
  it("the phone stayed offline past Rome midnight: the date is shown", () => {
    // 22:30Z on 2 November is 23:30 in Rome; 23:30Z is already 00:30 on the 3rd.
    expect(
      queuedOpenedLine("Giulia", "2026-11-02T22:30:00Z", new Date("2026-11-02T23:30:00Z")),
    ).toBe("Giulia · 02/11 23:30 · Apertura in coda");
  });
  it("UTC date differs but the Rome day is the same: no date", () => {
    // 00:30 Rome on 3 November is 23:30Z on the 2nd; now is 08:00Z on the 3rd.
    expect(
      queuedOpenedLine("Giulia", "2026-11-02T23:30:00Z", new Date("2026-11-03T08:00:00Z")),
    ).toBe("Giulia · 00:30 · Apertura in coda");
  });
  it("across the end of daylight saving time (25 October 2026): same Rome day, no date", () => {
    // 22:30Z on 24 October is 00:30 CEST on the 25th; 12:00Z on the 25th is 13:00 CET.
    expect(
      queuedOpenedLine("Giulia", "2026-10-24T22:30:00Z", new Date("2026-10-25T12:00:00Z")),
    ).toBe("Giulia · 00:30 · Apertura in coda");
  });
  it("DST start (28 March 2027, CET to CEST): 22:30Z on the 28th is already the 29th in Rome, so the date is shown", () => {
    // 23:30Z on 27 March is 00:30 CET on the 28th; 22:30Z on the 28th is 00:30 CEST on the 29th.
    expect(
      queuedOpenedLine("Giulia", "2027-03-27T23:30:00Z", new Date("2027-03-28T22:30:00Z")),
    ).toBe("Giulia · 28/03 00:30 · Apertura in coda");
  });
  it("DST end (25 October 2026): 22:30Z is 23:30 CET, still the same Rome day, so no date", () => {
    // 08:00Z on the 25th is 09:00 CET; 22:30Z is 23:30 CET, the same day.
    expect(
      queuedOpenedLine("Giulia", "2026-10-25T08:00:00Z", new Date("2026-10-25T22:30:00Z")),
    ).toBe("Giulia · 09:00 · Apertura in coda");
  });
  it("English", () => {
    expect(
      queuedOpenedLine("Giulia", "2026-11-02T19:14:00Z", new Date("2026-11-02T21:00:00Z"), "en"),
    ).toBe("Giulia · 20:14 · Opening queued");
  });
});

describe("sessionMetaLine (the opener line of a tile or panel, by where the session comes from)", () => {
  const NOW = new Date("2026-11-02T21:00:00Z");
  const base = {
    id: "5e000000-0000-4000-8000-000000000001",
    covers: 4,
    waiter: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Giulia" },
    billRequested: false,
    unsentCount: 0,
    uscite: null,
  };
  it("a server session: the server's open time and day", () => {
    expect(
      sessionMetaLine(
        {
          ...base,
          source: "server",
          openedAt: "2026-10-24T23:30:00+00:00",
          openedToday: false,
          coperto: null,
        },
        NOW,
      ),
    ).toBe("Giulia · 25/10 01:30");
  });
  it("a server session opened today", () => {
    expect(
      sessionMetaLine(
        {
          ...base,
          source: "server",
          openedAt: "2026-11-02T19:14:00+00:00",
          openedToday: true,
          coperto: null,
        },
        NOW,
      ),
    ).toBe("Giulia · 20:14");
  });
  it("a queued session: the tap time and 'Apertura in coda'", () => {
    expect(
      sessionMetaLine({ ...base, source: "queued", queuedAt: "2026-11-02T19:14:00Z" }, NOW),
    ).toBe("Giulia · 20:14 · Apertura in coda");
  });
  it("a queued session in English", () => {
    expect(
      sessionMetaLine({ ...base, source: "queued", queuedAt: "2026-11-02T19:14:00Z" }, NOW, "en"),
    ).toBe("Giulia · 20:14 · Opening queued");
  });
});

describe("copertoLine", () => {
  it("words the server's total", () => {
    expect(copertoLine({ perPerson: 1.5, vatRate: 10, total: 6 })).toMatch(/^Coperto 6,00\s€$/);
    expect(copertoLine({ perPerson: 1.5, vatRate: 10, total: 1234.5 })).toMatch(
      /^Coperto 1\.234,50\s€$/,
    );
  });
  it("is null when there is no coperto", () => {
    expect(copertoLine(null)).toBeNull();
  });
});

describe("nextCovers", () => {
  it("adds the step and stays within 1 to 99", () => {
    expect(nextCovers(4, 1)).toBe(5);
    expect(nextCovers(4, -1)).toBe(3);
    expect(nextCovers(1, -1)).toBe(1);
    expect(nextCovers(99, 1)).toBe(99);
    expect(nextCovers(0, 1)).toBe(1);
    expect(nextCovers(500, -1)).toBe(99);
  });
});

describe("W2 words (P2b-9)", () => {
  it("unsentBadge is 'Da inviare · n' and unsentDishes counts the dishes", () => {
    expect(unsentBadge(2)).toBe("Da inviare · 2");
    expect(unsentBadge(2, "en")).toBe("To send · 2");
    expect(unsentDishes(1)).toBe("1 piatto da inviare");
    expect(unsentDishes(2)).toBe("2 piatti da inviare");
    expect(unsentDishes(2, "en")).toBe("2 dishes to send");
    expect(unsentDishes(1, "en")).toBe("1 dish to send");
  });
});

describe("tileLabel (the tile's accessible name)", () => {
  const NOW = new Date("2026-11-02T21:00:00Z");
  const OPEN = shownTile(TABLES_LIST.tables[0]!);
  const FREE = shownTile(TABLES_LIST.tables[1]!);
  const withUnsent = (n: number | undefined): ShownTile => {
    const { session } = OPEN;
    if (session === null || session.source !== "server") throw new Error("fixture");
    const { unsentCount: _dropped, ...rest } = session;
    return {
      ...OPEN,
      session: n === undefined ? { ...rest } : { ...rest, unsentCount: n },
    } as ShownTile;
  };

  it("names the table, status, covers, opener with the time and the dishes to send", () => {
    expect(tileLabel(withUnsent(2), NOW)).toBe(
      "Tavolo 1 (demo), Aperto, 4 coperti, Cameriere Demo alle 20:15, 2 piatti da inviare",
    );
  });

  it("has no last part for 0, and none when the reply has no count (unknown, never 0)", () => {
    const base = "Tavolo 1 (demo), Aperto, 4 coperti, Cameriere Demo alle 20:15";
    expect(tileLabel(withUnsent(0), NOW)).toBe(base);
    expect(tileLabel(withUnsent(undefined), NOW)).toBe(base);
  });

  it("uses the date form for a table opened on an earlier day", () => {
    const table = withUnsent(1);
    const session = {
      ...table.session!,
      openedToday: false,
      openedAt: "2026-10-24T23:30:00+00:00",
    };
    expect(tileLabel({ ...table, session } as ShownTile, NOW)).toBe(
      "Tavolo 1 (demo), Aperto, 4 coperti, Cameriere Demo alle 25/10 01:30, 1 piatto da inviare",
    );
  });

  it("a free table is its name and status", () => {
    expect(tileLabel(FREE, NOW)).toBe("Tavolo 2 (demo), Libero");
  });

  it("a table opened on this phone says 'Apertura in coda' with the phone's time, and its real count", () => {
    const queued: ShownTile = {
      ...OPEN,
      session: {
        source: "queued",
        id: IDS.session1,
        covers: 4,
        waiter: { id: IDS.waiterA, displayName: "Giulia" },
        billRequested: false,
        unsentCount: 3,
        uscite: null,
        queuedAt: "2026-11-02T19:14:00Z",
      },
    };
    expect(tileLabel(queued, NOW)).toBe(
      "Tavolo 1 (demo), Aperto, 4 coperti, Giulia alle 20:14, Apertura in coda, 3 piatti da inviare",
    );
  });

  it("in English", () => {
    expect(tileLabel(withUnsent(2), NOW, "en")).toBe(
      "Tavolo 1 (demo), Open, 4 covers, Cameriere Demo at 20:15, 2 dishes to send",
    );
  });
});

describe("headerMetaLine (the comanda header's meta line, P2b-10)", () => {
  const NOW = new Date("2026-11-02T21:00:00Z");
  const server: SessionHeader = {
    openedBy: "Giulia",
    openedAt: "2026-11-02T19:14:00+00:00",
    openedToday: true,
    coperto: { perPerson: 2.5, vatRate: 10, total: 10 },
    queuedAt: null,
    queued: false,
  };
  const none: SessionHeader = {
    openedBy: null,
    openedAt: null,
    openedToday: null,
    coperto: UNKNOWN,
    queuedAt: null,
    queued: false,
  };

  it("online: covers, opener with the time, coperto total", () => {
    expect(headerMetaLine(4, server, NOW).replace(/\u00a0/g, " ")).toBe(
      "4 coperti · Giulia · 20:14 · Coperto 10,00 €",
    );
  });

  it("an earlier day takes the date form of openedLine", () => {
    expect(
      headerMetaLine(
        4,
        { ...server, openedToday: false, openedAt: "2026-10-24T23:30:00+00:00" },
        NOW,
      ),
    ).toMatch(/^4 coperti · Giulia · 25\/10 01:30 · Coperto/);
  });

  it("no coperto part when the server said the venue has none", () => {
    expect(headerMetaLine(4, { ...server, coperto: null }, NOW)).toBe("4 coperti · Giulia · 20:14");
  });

  it("queued: the phone's time and 'Apertura in coda', no coperto", () => {
    const queued: SessionHeader = {
      ...none,
      openedBy: "Giulia",
      queuedAt: "2026-11-02T19:14:00Z",
      queued: true,
    };
    expect(headerMetaLine(4, queued, NOW)).toBe("4 coperti · Giulia · 20:14 · Apertura in coda");
  });

  it("queued past midnight shows the date, and without a name only says 'Apertura in coda'", () => {
    const queued: SessionHeader = {
      ...none,
      openedBy: "Giulia",
      queuedAt: "2026-11-02T19:14:00Z",
      queued: true,
    };
    expect(headerMetaLine(4, queued, new Date("2026-11-02T23:30:00Z"))).toBe(
      "4 coperti · Giulia · 02/11 20:14 · Apertura in coda",
    );
    expect(headerMetaLine(4, { ...queued, openedBy: null }, NOW)).toBe(
      "4 coperti · Apertura in coda",
    );
  });

  it("queued with an unknown tap time: 'Apertura in coda' with no time and no coperto, never the server line", () => {
    const queued: SessionHeader = { ...none, openedBy: "Giulia", queuedAt: null, queued: true };
    expect(headerMetaLine(4, queued, NOW)).toBe("4 coperti · Giulia · Apertura in coda");
    expect(headerMetaLine(4, { ...queued, openedBy: null }, NOW)).toBe(
      "4 coperti · Apertura in coda",
    );
    expect(headerMetaLine(4, { ...queued, coperto: server.coperto }, NOW)).not.toContain("Coperto");
  });

  it("omits what is unknown, with no placeholder: a reply from before the fields is the covers only", () => {
    expect(headerMetaLine(4, none, NOW)).toBe("4 coperti");
    expect(headerMetaLine(1, none, NOW)).toBe("1 coperto");
    expect(headerMetaLine(4, { ...none, openedBy: "Giulia" }, NOW)).toBe("4 coperti");
    expect(headerMetaLine(4, { ...none, openedAt: "2026-11-02T19:14:00+00:00" }, NOW)).toBe(
      "4 coperti",
    );
    expect(headerMetaLine(4, { ...none, coperto: server.coperto }, NOW)).toMatch(
      /^4 coperti · Coperto 10,00/,
    );
  });

  it("in English", () => {
    expect(headerMetaLine(4, server, NOW, "en").replace(/\u00a0/g, " ")).toBe(
      "4 covers · Giulia · 20:14 · Cover charge €10.00",
    );
  });
});
