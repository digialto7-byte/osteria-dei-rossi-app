import { describe, expect, it } from "vitest";
import {
  canAct,
  canProduce,
  canReadBatchCosts,
  formatProposedQty,
  formatPortions,
  labelLines,
  movementLine,
  parseUsedQty,
  parseWholeNumber,
  portionsHint,
  qtyToInput,
  stateBadge,
  useByBadge,
} from "@/lib/batches/batch-view";

const LABEL = {
  batchId: "ba000000-0000-4000-8000-0000000000b1",
  recipeName: "Spezzatino (demo)",
  version: 1,
  producedAt: "2027-03-26T19:00:00Z",
  useBy: "2027-03-29T19:00:00Z",
  portions: 31,
  lotCode: "270326-SPEZZA-1",
  operatorInitials: "CD",
  shelfLifeHours: 72,
};

describe("labelLines (AT6 in TS)", () => {
  it("writes the six lines, in Europe/Rome, across the 2027-03-28 clock change", () => {
    expect(labelLines(LABEL)).toEqual([
      "Spezzatino (demo)",
      "Prodotto: 26/03/2027 20:00",
      "Da consumare entro: 29/03/2027 21:00",
      "Porzioni: 31",
      "Lotto: 270326-SPEZZA-1",
      "Operatore: CD",
    ]);
  });

  it("shows 00:30 on 25 October in Rome for 2026-10-24T22:30Z", () => {
    const lines = labelLines({ ...LABEL, producedAt: "2026-10-24T22:30:00Z" });
    expect(lines[1]).toBe("Prodotto: 25/10/2026 00:30");
  });

  it("shows the autumn change too: 72 elapsed hours from 2026-10-23T19:00Z end at 20:00 Rome on 26 October", () => {
    const lines = labelLines({
      ...LABEL,
      producedAt: "2026-10-23T19:00:00Z",
      useBy: "2026-10-26T19:00:00Z",
    });
    expect([lines[1], lines[2]]).toEqual([
      "Prodotto: 23/10/2026 21:00",
      "Da consumare entro: 26/10/2026 20:00",
    ]);
  });

  it("reads an offset as well as a Z", () => {
    expect(labelLines({ ...LABEL, producedAt: "2027-03-26T20:00:00+01:00" })[1]).toBe(
      "Prodotto: 26/03/2027 20:00",
    );
  });

  it("has English lines", () => {
    expect(labelLines(LABEL, "en")).toEqual([
      "Spezzatino (demo)",
      "Produced: 26/03/2027 20:00",
      "Use by: 29/03/2027 21:00",
      "Portions: 31",
      "Lot: 270326-SPEZZA-1",
      "Operator: CD",
    ]);
  });

  it("rejects an instant that is not a date", () => {
    expect(() => labelLines({ ...LABEL, useBy: "soon" })).toThrow(RangeError);
  });
});

describe("useByBadge", () => {
  it("words expired and due_soon, and shows nothing for ok", () => {
    expect(useByBadge("expired")).toEqual({ tone: "danger", label: "Scaduto" });
    expect(useByBadge("due_soon")).toEqual({ tone: "warning", label: "In scadenza" });
    expect(useByBadge("ok")).toBeNull();
    expect(useByBadge("expired", "en")).toEqual({ tone: "danger", label: "Expired" });
    expect(useByBadge("due_soon", "en")).toEqual({ tone: "warning", label: "Due soon" });
  });
});

describe("the role helpers mirror the routes", () => {
  it("canProduce: owner, admin and chef; not the waiter or an unknown role", () => {
    for (const role of ["owner", "admin", "chef"]) expect(canProduce(role), role).toBe(true);
    for (const role of ["waiter", "", "visitor"]) expect(canProduce(role), role).toBe(false);
  });

  it("canReadBatchCosts: owner and admin only (Q16 = project V6)", () => {
    for (const role of ["owner", "admin"]) expect(canReadBatchCosts(role), role).toBe(true);
    for (const role of ["chef", "waiter", "", "visitor"]) {
      expect(canReadBatchCosts(role), role).toBe(false);
    }
  });
});

describe("portionsHint", () => {
  it("says how the computed number was made", () => {
    expect(portionsHint(31, 0.2, "kg")).toBe(
      "Calcolate: 31 (0,2 kg a porzione, arrotondate per difetto)",
    );
    expect(portionsHint(31, 0.2, "kg", "en")).toBe(
      "Calculated: 31 (0.2 kg per portion, rounded down)",
    );
  });
});

describe("the form helpers", () => {
  it("parseUsedQty reads digits with a comma or a point, at most 4 decimals, and allows 0", () => {
    expect(parseUsedQty("5,3")).toBe(5.3);
    expect(parseUsedQty("0.2067")).toBe(0.2067);
    expect(parseUsedQty("0")).toBe(0);
    expect(parseUsedQty(" 12 ")).toBe(12);
    for (const text of ["", "-1", "1,23456", "1.000,5", "abc", "1,", ",5", "1e3", "+2"]) {
      expect(parseUsedQty(text), text).toBeNull();
    }
  });

  it("parseWholeNumber reads digits only", () => {
    expect(parseWholeNumber("31")).toBe(31);
    expect(parseWholeNumber(" 72 ")).toBe(72);
    for (const text of ["", "3,5", "-2", "1.000", "x"])
      expect(parseWholeNumber(text), text).toBeNull();
  });

  it("formatProposedQty keeps the 4 decimals of the proposal, in Italian", () => {
    expect(formatProposedQty(5.1667, "kg")).toBe("5,1667 kg");
    expect(formatProposedQty(0.31, "kg")).toBe("0,31 kg");
    expect(formatProposedQty(1.0333, "l", "en")).toBe("1.0333 l");
  });

  it("qtyToInput writes a number the way the chef types it", () => {
    expect(qtyToInput(5.1667)).toBe("5,1667");
    expect(qtyToInput(0)).toBe("0");
    expect(qtyToInput(31)).toBe("31");
  });
});

describe("stateBadge (A5: Scartato vs Finito)", () => {
  it("words open, finished and discarded; a fresh batch shows none", () => {
    expect(stateBadge("fresh")).toBeNull();
    expect(stateBadge("open")).toEqual({ tone: "neutral", label: "Aperto" });
    expect(stateBadge("finished")).toEqual({ tone: "neutral", label: "Finito" });
    expect(stateBadge("discarded")).toEqual({ tone: "neutral", label: "Scartato" });
  });

  it("has English words", () => {
    expect(stateBadge("open", "en")?.label).toBe("Open");
    expect(stateBadge("finished", "en")?.label).toBe("Finished");
    expect(stateBadge("discarded", "en")?.label).toBe("Discarded");
  });
});

describe("formatPortions", () => {
  it("says one portion in the singular and the rest in the plural, with a plain space", () => {
    expect(formatPortions(1)).toBe("1 porzione");
    expect(formatPortions(3)).toBe("3 porzioni");
    expect(formatPortions(0)).toBe("0 porzioni");
    expect(formatPortions(0.5)).toBe("0,5 porzioni");
    expect(formatPortions(1234.5678)).toBe("1.234,5678 porzioni");
    expect(formatPortions(2, "en")).toBe("2 portions");
    expect(formatPortions(1, "en")).toBe("1 portion");
    expect(formatPortions(0.5, "en")).toBe("0.5 portions");
  });

  it("signs a movement with the real minus sign, and a plus for a gain", () => {
    expect(formatPortions(-3, "it", true)).toBe("−3 porzioni");
    expect(formatPortions(-1, "it", true)).toBe("−1 porzione");
    expect(formatPortions(4, "it", true)).toBe("+4 porzioni");
  });
});

describe("movementLine", () => {
  const at = "2026-10-24T10:10:00Z"; // 12:10 in Rome (summer time until the night of 25 October)
  const move = (over: object) => ({
    id: "0e000000-0000-4000-8000-0000000000e1",
    type: "waste" as const,
    portions: -3,
    reasonCode: "spoilage" as const,
    refType: "batch_discard",
    at,
    byInitials: "CD",
    byMe: true,
    ...over,
  });

  it("words a discard with its reason", () => {
    expect(movementLine(move({}))).toBe(
      "Scarto · Deteriorato · −3 porzioni · CD · 24/10/2026 12:10",
    );
  });

  it("words a count, a split out and a split in, a staff meal and a production", () => {
    expect(
      movementLine(
        move({ type: "count", portions: -1, reasonCode: null, refType: "batch_adjust" }),
      ),
    ).toBe("Conteggio · −1 porzione · CD · 24/10/2026 12:10");
    expect(
      movementLine(move({ type: "split", portions: -4, reasonCode: null, refType: "batch_split" })),
    ).toBe("Divisione · −4 porzioni · CD · 24/10/2026 12:10");
    expect(
      movementLine(move({ type: "split", portions: 4, reasonCode: null, refType: "batch_split" })),
    ).toBe("Divisione · +4 porzioni · CD · 24/10/2026 12:10");
    expect(
      movementLine(move({ portions: -2, reasonCode: "staff_meal", refType: "staff_meal" })),
    ).toBe("Pasto personale · −2 porzioni · CD · 24/10/2026 12:10");
    expect(
      movementLine(move({ type: "produce", portions: 10, reasonCode: null, refType: "batch" })),
    ).toBe("Produzione · +10 porzioni · CD · 24/10/2026 12:10");
  });

  it("is in venue time across the autumn change (00:30 on 25 October is CEST)", () => {
    expect(movementLine(move({ at: "2026-10-24T22:30:00Z" }))).toContain("25/10/2026 00:30");
    expect(movementLine(move({ at: "2026-10-25T01:30:00Z" }))).toContain("25/10/2026 02:30");
  });

  it("has English words", () => {
    expect(movementLine(move({}), "en")).toBe(
      "Discard · Spoilage · −3 portions · CD · 24/10/2026 12:10",
    );
    expect(
      movementLine(
        move({ type: "count", portions: 2, reasonCode: null, refType: "batch_adjust" }),
        "en",
      ),
    ).toBe("Count · +2 portions · CD · 24/10/2026 12:10");
  });
});

describe("labelLines, extended (M15)", () => {
  const CHILD = {
    ...LABEL,
    portions: 4,
    portionsRemaining: 4,
    lotCode: "261024-RAGUDE-3",
    splitFrom: { lotCode: "261023-RAGUDE-2" },
  };

  it("prints the portions still in the batch, and a seventh line for the parent lot", () => {
    const lines = labelLines(CHILD);
    expect(lines).toHaveLength(7);
    expect(lines[3]).toBe("Porzioni: 4");
    expect(lines[6]).toBe("Diviso da: 261023-RAGUDE-2");
  });

  it("prints the remaining portions of a batch that was reduced", () => {
    expect(labelLines({ ...LABEL, portions: 10, portionsRemaining: 6, splitFrom: null })[3]).toBe(
      "Porzioni: 6",
    );
  });

  it("has no seventh line without a parent, and English words", () => {
    expect(labelLines({ ...LABEL, portionsRemaining: 31, splitFrom: null })).toHaveLength(6);
    expect(labelLines(CHILD, "en")[6]).toBe("Split from: 261023-RAGUDE-2");
  });
});

describe("canAct", () => {
  it("is owner, admin and chef; not the waiter", () => {
    for (const role of ["owner", "admin", "chef"]) expect(canAct(role), role).toBe(true);
    for (const role of ["waiter", "", "visitor"]) expect(canAct(role), role).toBe(false);
  });
});
