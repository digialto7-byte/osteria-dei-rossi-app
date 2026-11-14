import { describe, expect, it } from "vitest";
import {
  batchHref,
  canTrace,
  formatShortDate,
  formatShortDateTime,
  formatTimeRange,
  lineHref,
  lineText,
  lotCodeText,
  lotHref,
  lotMetaLine,
  lotSearchQuery,
  outcomeText,
  reachedLotText,
  plateLine,
  portionsShort,
  qtyText,
} from "@/lib/trace/trace-view";

const ID = "5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f";
// Fixture dates are in 1998 (the no-date-bombs guard). 1998-11-13 12:40 Rome (CET) is 11:40 UTC.
const FIRST = "1998-11-13T11:40:00.000Z";
const LAST = "1998-11-13T13:55:00.000Z";

describe("canTrace", () => {
  it("is for the owner, the admin and the chef; never the waiter or an unknown role", () => {
    expect(["owner", "admin", "chef", "waiter", "", undefined].map((r) => canTrace(r))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("dates and times (Europe/Rome)", () => {
  it("writes a calendar day short, and an instant with its Rome clock time", () => {
    expect(formatShortDate("1998-11-13")).toBe("13 nov");
    expect(formatShortDateTime(FIRST)).toBe("13 nov, 12:40");
    expect(formatShortDateTime(FIRST, "en")).toMatch(/^Nov 13, 12:40$|^13 Nov, 12:40$/);
  });

  it("uses the summer offset in summer", () => {
    expect(formatShortDateTime("1998-07-01T10:05:00.000Z")).toBe("1 lug, 12:05");
  });

  it("writes a range of two instants with an en dash", () => {
    expect(formatTimeRange(FIRST, LAST)).toBe("12:40–14:55");
  });
});

describe("quantities", () => {
  it("writes a quantity in its unit with the Italian comma, and a real minus", () => {
    expect(qtyText(1.5, "kg")).toBe("1,5 kg");
    expect(qtyText(-0.5, "kg")).toBe("−0,5 kg");
  });

  it("writes portions short", () => {
    expect(portionsShort(12)).toBe("12 porz.");
    expect(portionsShort(1.4)).toBe("1,4 porz.");
    expect(portionsShort(12, "en")).toBe("12 port.");
  });
});

describe("lot lines", () => {
  it("says 'Lotto senza codice' for a lot with no code", () => {
    expect(lotCodeText("L-DEMO-0001")).toBe("L-DEMO-0001");
    expect(lotCodeText(null)).toBe("Lotto senza codice");
  });

  it("writes the meta line: ingredient, supplier, delivery day", () => {
    expect(
      lotMetaLine({
        ingredient: { name: "Farina Demo" },
        supplier: { name: "Fornitore Demo 1" },
        receivedOn: "1998-11-13",
      }),
    ).toBe("Farina Demo · Fornitore Demo 1 · consegna 13 nov");
  });
});

describe("plates", () => {
  const plate = {
    businessDate: "1998-11-13",
    menuItemId: ID,
    name: "Lasagne Demo",
    lines: 14,
    portions: 14,
    firstAt: FIRST,
    lastAt: LAST,
    via: "batch" as const,
  };

  it("writes a plate group: day, dish, plates (portions), times", () => {
    expect(plateLine(plate)).toBe("13 nov · Lasagne Demo · 14 piatti (14 porz.) · 12:40–14:55");
    expect(plateLine({ ...plate, lines: 1, portions: 1.4 })).toBe(
      "13 nov · Lasagne Demo · 1 piatto (1,4 porz.) · 12:40–14:55",
    );
  });

  it("says 'senza preparazione' for a plate that used the raw ingredient directly", () => {
    expect(plateLine({ ...plate, via: "direct", lines: 3, portions: 3 })).toBe(
      "13 nov · Lasagne Demo · 3 piatti (3 porz.) · 12:40–14:55 · senza preparazione",
    );
  });

  it("writes a served plate of the day search: time, table, dish, portions", () => {
    expect(
      lineText({
        menuItemName: "Lasagne Demo",
        tableName: "Tavolo 7",
        firedAt: FIRST,
        portions: 1,
      }),
    ).toBe("13 nov · 12:40 · Tavolo 7 · Lasagne Demo · 1 porz.");
  });
});

describe("links", () => {
  it("builds the three trace page addresses", () => {
    expect(lotHref(ID)).toBe(`/tracciabilita/lotto/${ID}`);
    expect(batchHref(ID)).toBe(`/tracciabilita/produzione/${ID}`);
    expect(lineHref(ID)).toBe(`/tracciabilita/piatto/${ID}`);
  });
});

describe("lotSearchQuery", () => {
  it("sends exactly the typed filters, trimmed, and nothing for an empty one", () => {
    expect(
      lotSearchQuery({ q: "  L-2311 ", ingredientId: "", supplierId: "", from: "", to: "" }),
    ).toBe("q=L-2311");
    expect(
      lotSearchQuery({
        q: "",
        ingredientId: ID,
        supplierId: ID,
        from: "1998-11-01",
        to: "1998-11-13",
      }),
    ).toBe(`ingredientId=${ID}&supplierId=${ID}&from=1998-11-01&to=1998-11-13`);
  });

  it("is null when no code, ingredient or supplier is given (dates alone do not search)", () => {
    expect(
      lotSearchQuery({ q: " ", ingredientId: "", supplierId: "", from: "1998-11-01", to: "" }),
    ).toBeNull();
  });
});

describe("outcomeText and reachedLotText", () => {
  it("words the portions that were sold, discarded and left, singular and plural", () => {
    expect(outcomeText({ sold: 31, wasted: 2, remaining: 7 })).toBe(
      "31 vendute, 2 scartate, 7 rimaste",
    );
    expect(outcomeText({ sold: 1, wasted: 1, remaining: 1 })).toBe(
      "1 venduta, 1 scartata, 1 rimasta",
    );
    expect(outcomeText({ sold: 1.5, wasted: 0, remaining: 0 })).toBe(
      "1,5 vendute, 0 scartate, 0 rimaste",
    );
  });

  it("writes a lot reached from a batch: ingredient, quantity, lot, supplier, delivery", () => {
    const lot = {
      lotCode: "L-2311-A",
      receivedOn: "1998-11-13",
      supplier: { name: "Fornitore Demo 1" },
    };
    expect(reachedLotText({ lead: "Farina Demo", qty: "6 kg", lot })).toBe(
      "Farina Demo · 6 kg · lotto L-2311-A · Fornitore Demo 1 · consegna 13 nov",
    );
    expect(reachedLotText({ lead: "Farina Demo", lot: { ...lot, lotCode: null } })).toBe(
      "Farina Demo · Lotto senza codice · Fornitore Demo 1 · consegna 13 nov",
    );
  });
});
