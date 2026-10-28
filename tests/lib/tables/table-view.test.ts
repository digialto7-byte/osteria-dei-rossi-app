import { describe, expect, it } from "vitest";
import {
  canConfigureTables,
  canUseTables,
  copertoLine,
  coversLine,
  nextCovers,
  openedLine,
  statusTone,
  statusWord,
  TABLE_STATUSES,
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
  it("words the five statuses in Italian", () => {
    expect(TABLE_STATUSES.map((s) => statusWord(s))).toEqual([
      "Libero",
      "Aperto",
      "Portate inviate",
      "Conto richiesto",
      "Chiuso",
    ]);
  });
  it("words them in English too", () => {
    expect(TABLE_STATUSES.map((s) => statusWord(s, "en"))).toEqual([
      "Free",
      "Open",
      "Courses sent",
      "Bill requested",
      "Closed",
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
