import { describe, expect, it } from "vitest";
import {
  avtRowText,
  businessDayTitle,
  countOptionLabel,
  deltaWords,
  emptyText,
  formatDelta,
  formatDeltaPct,
  formatDeltaPoints,
  hourRows,
  itemStatusLabel,
  monthLabel,
  missingRegisterText,
  packCountPair,
  packFigureLine,
  provisionalNote,
  unmappedWeekLabel,
  weekdayLabel,
  weekdayRows,
  yesterdayHint,
  yesterdayTitle,
} from "@/lib/reports/report-view";
import { AVT } from "../../helpers/report-data";

const MINUS = "−";

describe("formatDelta", () => {
  it("writes a count delta with its percentage", () => {
    expect(formatDelta(3, 150)).toMatch(/^\+3 \(\+150,0\s+%\)$/);
  });
  it("uses the real minus sign and no percentage when it is unknown", () => {
    expect(formatDelta(-2.5, null)).toBe(`${MINUS}2,5`);
    expect(formatDelta(-2.5, null)).not.toContain("%");
    expect(formatDelta(-2.5, null)).not.toContain("-");
  });
  it("a negative percentage uses the minus sign too", () => {
    expect(formatDelta(-3, -37.5)).toMatch(new RegExp(`^${MINUS}3 \\(${MINUS}37,5\\s+%\\)$`));
  });
  it("zero carries no sign", () => {
    expect(formatDelta(0, 0)).toMatch(/^0 \(0,0\s+%\)$/);
    expect(formatDelta(0, null)).toBe("0");
  });
  it("english keeps the same shape", () => {
    expect(formatDelta(1234.5, 12.5, "en")).toMatch(/^\+1,234\.5 \(\+12\.5\s*%\)$/);
  });
});

describe("formatDeltaPoints (a change of a percentage is in percentage points)", () => {
  it("writes the points with their unit and the relative change", () => {
    expect(formatDeltaPoints(2.1, 7.3)).toMatch(/^\+2,1\s+pt \(\+7,3\s+%\)$/);
  });
  it("uses the real minus sign, one decimal, and no relative change when unknown", () => {
    expect(formatDeltaPoints(-2, null)).toMatch(new RegExp(`^${MINUS}2,0\\s+pt$`));
  });
  it("zero carries no sign", () => {
    expect(formatDeltaPoints(0, 0)).toMatch(/^0,0\s+pt \(0,0\s+%\)$/);
  });
  it("english says pp", () => {
    expect(formatDeltaPoints(2.1, 7.3, "en")).toMatch(/^\+2\.1\s+pp \(\+7\.3\s*%\)$/);
  });
});

describe("formatDeltaPct and deltaWords", () => {
  it("prints the percentage alone, signed", () => {
    expect(formatDeltaPct(162.1)).toMatch(/^\+162,1\s+%$/);
    expect(formatDeltaPct(-4)).toMatch(new RegExp(`^${MINUS}4,0\\s+%$`));
  });
  it("prints nothing when the percentage is unknown", () => {
    expect(formatDeltaPct(null)).toBe("");
  });
  it("names the direction, so colour is never the only signal", () => {
    expect(deltaWords(3)).toBe("in più");
    expect(deltaWords(-0.01)).toBe("in meno");
    expect(deltaWords(0)).toBe("");
    expect(deltaWords(3, "en")).toBe("more");
    expect(deltaWords(-3, "en")).toBe("less");
  });
});

describe("hourRows and weekdayRows", () => {
  const hours = Array.from({ length: 24 }, (_, h) => (h === 20 ? 3 : h === 21 ? 2 : 0));
  it("hides the hours with no cover on the phone", () => {
    expect(hourRows(hours)).toEqual([
      { hour: 20, label: "20", covers: 3 },
      { hour: 21, label: "21", covers: 2 },
    ]);
  });
  it("keeps all 24 hours when asked", () => {
    const all = hourRows(hours, false);
    expect(all).toHaveLength(24);
    expect(all[0]).toEqual({ hour: 0, label: "00", covers: 0 });
  });
  it("refuses an array that is not 24 long", () => {
    expect(() => hourRows([1, 2])).toThrow();
  });
  it("weekdayLabel(0) is Monday", () => {
    expect(weekdayLabel(0)).toBe("lun");
    expect(weekdayLabel(2)).toBe("mer");
    expect(weekdayLabel(6)).toBe("dom");
    expect(weekdayLabel(0, "en")).toBe("Mon");
  });
  it("weekdayLabel refuses an index outside 0-6", () => {
    expect(() => weekdayLabel(7)).toThrow();
    expect(() => weekdayLabel(-1)).toThrow();
  });
  it("weekdayRows are always the 7 days, Monday first", () => {
    const rows = weekdayRows([0, 0, 5, 0, 0, 0, 0]);
    expect(rows).toHaveLength(7);
    expect(rows[2]).toEqual({ index: 2, label: "mer", covers: 5 });
    expect(() => weekdayRows([1])).toThrow();
  });
});

describe("titles and hints", () => {
  it("names the business day", () => {
    expect(businessDayTitle("2026-11-04")).toBe("mercoledì 4 novembre");
    expect(businessDayTitle("2026-11-04", "en")).toBe("Wednesday 4 November");
  });
  it("refuses a date that is not real", () => {
    expect(() => businessDayTitle("2026-13-40")).toThrow();
  });
  it("the yesterday title", () => {
    expect(yesterdayTitle("2026-11-04")).toBe("Ieri · mercoledì 4 novembre");
  });
  it("the hint says which revenue the food cost % is on", () => {
    expect(yesterdayHint(71.5909, 119.1281)).toMatch(
      /^sui piatti con costo noto \(71,59\s+€ di 119,13\s+€\)$/,
    );
  });
});

describe("notes", () => {
  it("says how many days are not closed yet", () => {
    expect(provisionalNote(6, 7)).toBe("Provvisorio: 1 giorno su 7 non ancora chiuso");
    expect(provisionalNote(4, 7)).toBe("Provvisorio: 3 giorni su 7 non ancora chiusi");
    expect(provisionalNote(7, 7)).toBeNull();
  });
  it("lists the dates with no register total", () => {
    expect(missingRegisterText(["2026-10-28"])).toBe("Totale cassa non inserito: 28 ott");
    expect(missingRegisterText(["2026-10-28", "2026-11-01"])).toBe(
      "Totale cassa non inserito: 28 ott, 1 nov",
    );
    expect(missingRegisterText([])).toBeNull();
  });
  it("names the unmapped week with the Italian elision", () => {
    expect(unmappedWeekLabel("2026-11-02", "2026-11-08")).toBe("Settimana dal 02/11 all'08/11");
    expect(unmappedWeekLabel("2026-11-09", "2026-11-15")).toBe("Settimana dal 09/11 al 15/11");
    expect(unmappedWeekLabel("2026-11-02", "2026-11-11")).toBe("Settimana dal 02/11 all'11/11");
    expect(unmappedWeekLabel("2026-11-09", "2026-11-15", "en")).toBe("Week from 09/11 to 15/11");
  });
  it("labels a count in the picker", () => {
    expect(countOptionLabel("2026-11-30T10:00:00+00:00", "Cella (demo)")).toBe(
      "Inventario mensile del 30/11 · Cella (demo)",
    );
  });
});

describe("item status labels", () => {
  it("names what needs attention and nothing else", () => {
    expect(itemStatusLabel("unmapped")).toBe("Senza ricetta");
    expect(itemStatusLabel("incomplete")).toBe("Costo incompleto");
    expect(itemStatusLabel("partial")).toBe("Costo parziale");
    expect(itemStatusLabel("costed")).toBeNull();
  });
});

describe("avtRowText", () => {
  it("reads like the plan's example", () => {
    const text = avtRowText(AVT.rows[0]!);
    expect(text).toMatch(
      /^Manzo \(demo\) · consumato 5,8\s+kg · da ricetta 5,0\s+kg · scarti registrati 0,2\s+kg · differenza \+0,8\s+kg · 9,60\s+€$/,
    );
  });
  it("leaves the euro out when the cost is unknown", () => {
    expect(avtRowText(AVT.rows[1]!)).toMatch(/differenza \+0,5\s+kg$/);
    expect(avtRowText(AVT.rows[1]!)).not.toContain("€");
  });
});

describe("empty texts", () => {
  it("has the Italian text of every empty state of the plan", () => {
    expect(emptyText("noTablesYesterday")).toBe("Nessun tavolo chiuso ieri.");
    expect(emptyText("avtNoCount")).toBe("Serve un inventario mensile chiuso.");
    expect(emptyText("avtNoOpening")).toBe("Serve un secondo inventario mensile per confrontare.");
    expect(emptyText("avtManyLocations")).toBe("Con più ubicazioni il confronto è indicativo.");
    expect(emptyText("unmappedNone")).toBe("Tutti i piatti venduti hanno una ricetta.");
    expect(emptyText("reserved")).toBe("I report sono riservati al titolare e all'amministratore.");
  });
  it("has an English text for each", () => {
    for (const key of [
      "noTablesYesterday",
      "avtNoCount",
      "avtNoOpening",
      "avtManyLocations",
      "unmappedNone",
      "reserved",
    ] as const) {
      expect(emptyText(key, "en")).not.toBe(emptyText(key));
    }
  });
});

describe("monthLabel (M24)", () => {
  it("writes the month and year in words", () => {
    expect(monthLabel("2026-10", "it")).toBe("ottobre 2026");
    expect(monthLabel("2026-10", "en")).toBe("October 2026");
    expect(monthLabel("2027-01")).toBe("gennaio 2027");
  });

  it.each(["2026-13", "2026-00", "2026-1", "2026-10-01", ""])("refuses %j", (month) => {
    expect(() => monthLabel(month)).toThrow(RangeError);
  });
});

describe("packFigureLine (M24)", () => {
  const base = { label: "Coperti", current: "312", previous: "290" };

  it("reads 'valore · mese precedente · differenza' in words", () => {
    const line = packFigureLine(
      { ...base, delta: { abs: 22, pct: 7.59 }, kind: "count" },
      "settembre 2026",
    );
    expect(line).toMatch(/^Coperti 312 · settembre 2026 290 · \+22 \(\+7,6\s+%\) in più$/);
  });

  it("writes a euro change with the euro sign and the real minus for a fall", () => {
    expect(
      packFigureLine(
        {
          label: "Acquisti",
          current: "2.345,60 €",
          previous: "2.100,00 €",
          delta: { abs: 245.6, pct: 11.69 },
          kind: "eur",
        },
        "settembre 2026",
      ),
    ).toMatch(/· \+245,60\s+€ \(\+11,7\s+%\) in più$/);
    expect(
      packFigureLine({ ...base, delta: { abs: -10, pct: -4 }, kind: "eur" }, "settembre 2026"),
    ).toMatch(/· −10,00\s+€ \(−4,0\s+%\) in meno$/);
  });

  it("writes a change of a percentage in points", () => {
    expect(
      packFigureLine(
        {
          label: "Food cost",
          current: "30,0 %",
          previous: "28,0 %",
          delta: { abs: 2, pct: 7.1 },
          kind: "points",
        },
        "settembre 2026",
      ),
    ).toMatch(/· \+2,0\s+pt \(\+7,1\s+%\) in più$/);
  });

  it("leaves the change out when there is none", () => {
    expect(packFigureLine({ ...base, delta: null, kind: "count" }, "settembre 2026")).toBe(
      "Coperti 312 · settembre 2026 290",
    );
  });

  it("says nothing in words for a change of zero", () => {
    expect(
      packFigureLine({ ...base, delta: { abs: 0, pct: 0 }, kind: "count" }, "settembre 2026"),
    ).not.toMatch(/in più|in meno/);
  });
});

describe("packCountPair (M24)", () => {
  it("names the two counts by their Rome dates and the location", () => {
    expect(packCountPair(AVT)).toBe(
      "Inventario del 30/11/2026 rispetto al 01/11/2026 · Cella (demo)",
    );
  });

  it("uses the Rome date: a count closed at 23:30Z on 31 October is 1 November", () => {
    const late = { ...AVT, count: { ...AVT.count, closedAt: "2026-10-31T23:30:00+00:00" } };
    expect(packCountPair(late)).toMatch(/^Inventario del 01\/11\/2026 /);
  });
});
