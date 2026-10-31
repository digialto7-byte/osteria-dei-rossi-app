import { describe, expect, it } from "vitest";
import { discardsRowText, discardsTotalsText, emptyText } from "@/lib/reports/report-view";
import { DISCARDS } from "../../helpers/push-data";

const plain = (text: string) => text.replace(/ /g, " ");
const [RAGU, STEW] = DISCARDS.rows as [(typeof DISCARDS.rows)[0], (typeof DISCARDS.rows)[1]];

describe("discardsRowText (AT7: one line per batch recipe)", () => {
  it("a pushed batch: 'era in evidenza'", () => {
    expect(plain(discardsRowText(STEW, "it"))).toBe(
      "Spezzatino · durata 48 h · 1 lotto scartato, 1 era in evidenza · 3 porzioni · 8,14 €",
    );
  });

  it("a batch that was not pushed: '0 in evidenza'", () => {
    expect(plain(discardsRowText(RAGU, "it"))).toBe(
      "Ragù (demo) · durata 72 h · 1 lotto scartato, 0 in evidenza · 5 porzioni · 7,50 €",
    );
  });

  it("several batches are plural", () => {
    const row = { ...STEW, batchesDiscarded: 3, batchesPushed: 2, portionsDiscarded: 1 };
    expect(plain(discardsRowText(row, "it"))).toBe(
      "Spezzatino · durata 48 h · 3 lotti scartati, 2 erano in evidenza · 1 porzione · 8,14 €",
    );
  });

  it("English", () => {
    expect(plain(discardsRowText(STEW, "en"))).toBe(
      "Spezzatino · shelf life 48 h · 1 batch thrown away, 1 was featured · 3 portions · €8.14",
    );
  });

  it("a value with some unknown costs says so; an all-unknown row has no amount", () => {
    expect(plain(discardsRowText({ ...STEW, unvaluedCount: 1 }, "it"))).toMatch(
      /· 8,14 € \(\+ 1 senza costo\)$/,
    );
    const unknown = plain(discardsRowText({ ...STEW, valueEur: 0, unvaluedCount: 1 }, "it"));
    expect(unknown).toMatch(/· costo non noto$/);
    expect(unknown).not.toContain("0,00");
  });
});

describe("discardsTotalsText", () => {
  it("sums up the week as the database did", () => {
    expect(plain(discardsTotalsText(DISCARDS.totals, "it"))).toBe(
      "2 lotti scartati, 1 era in evidenza · 8 porzioni · 15,64 €",
    );
  });
});

describe("the empty text", () => {
  it("says no batch was thrown away", () => {
    expect(emptyText("discardsNone")).toBe("Nessuna preparazione scartata in questa settimana.");
    expect(emptyText("discardsNone", "en")).not.toBe(emptyText("discardsNone"));
  });
});
