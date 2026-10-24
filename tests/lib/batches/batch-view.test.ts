import { describe, expect, it } from "vitest";
import {
  canProduce,
  canReadBatchCosts,
  formatProposedQty,
  labelLines,
  parseUsedQty,
  parseWholeNumber,
  portionsHint,
  qtyToInput,
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
