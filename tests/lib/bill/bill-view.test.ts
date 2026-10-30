import { describe, expect, it } from "vitest";
import {
  copertoLabel,
  groupBillLines,
  lineLabel,
  partLabel,
  paymentTypeLabel,
  qtyLabel,
  receiptSummary,
  receiptTypeLabel,
  unsentWarning,
} from "@/lib/bill/bill-view";
import { formatEuro } from "@/lib/money/format";
import { BILL, BILL_CLOSED, RECEIPT } from "../../helpers/bill-data";

const nb = (s: string) => s.replace(/(\d) (€|%)/g, "$1" + String.fromCharCode(160) + "$2");

describe("bill view helpers", () => {
  it("formats amounts the venue way (the only formatting the screen does)", () => {
    expect(formatEuro(BILL.total)).toBe(nb("100,00 €"));
    expect(formatEuro(1234.5)).toBe(nb("1.234,50 €"));
  });

  it("writes quantities with a half sign for 0,5", () => {
    expect(qtyLabel(0.5)).toBe("½");
    expect(qtyLabel(1.5)).toBe("1,5");
    expect(qtyLabel(2)).toBe("2");
  });

  it("labels a line as quantity x name", () => {
    expect(lineLabel(BILL.lines[1]!)).toBe("2 × Spezzatino con polenta (demo)");
    expect(lineLabel(BILL.lines[2]!)).toBe("½ × Spezzatino con polenta (demo)");
  });

  it("labels the parts", () => {
    expect(partLabel(1)).toBe("Quota 1");
    expect(partLabel(12)).toBe("Quota 12");
    expect(partLabel(2, "en")).toBe("Share 2");
  });

  it("words the unsent warning in singular and plural", () => {
    expect(unsentWarning(1)).toBe(
      "1 piatto non è stato inviato in cucina: invialo o rimuovilo prima di chiudere.",
    );
    expect(unsentWarning(2)).toBe(
      "2 piatti non sono stati inviati in cucina: inviali o rimuovili prima di chiudere.",
    );
    expect(unsentWarning(2, "en")).toContain("2 dishes");
  });

  it("labels the coperto with covers, per person and no sum of its own", () => {
    expect(copertoLabel(BILL.coperto!)).toBe(nb("Coperto · 3 × 2,00 €"));
  });

  it("labels the documents and payments in both languages", () => {
    expect([receiptTypeLabel("scontrino"), receiptTypeLabel("fattura")]).toEqual([
      "Scontrino",
      "Fattura",
    ]);
    expect([paymentTypeLabel("cash"), paymentTypeLabel("card"), paymentTypeLabel("other")]).toEqual(
      ["Contanti", "Carta", "Altro"],
    );
    expect([receiptTypeLabel("scontrino", "en"), receiptTypeLabel("fattura", "en")]).toEqual([
      "Receipt",
      "Invoice",
    ]);
    expect([
      paymentTypeLabel("cash", "en"),
      paymentTypeLabel("card", "en"),
      paymentTypeLabel("other", "en"),
    ]).toEqual(["Cash", "Card", "Other"]);
  });

  it("summarises a closed table with and without a number", () => {
    expect(receiptSummary(RECEIPT)).toBe("Tavolo chiuso · Scontrino 0012-0034 · Carta");
    expect(receiptSummary({ ...RECEIPT, number: null, missingReceipt: true })).toBe(
      "Tavolo chiuso · senza numero di scontrino",
    );
    expect(
      receiptSummary({ ...RECEIPT, type: "fattura", number: null, missingReceipt: true }),
    ).toBe("Tavolo chiuso · senza numero di fattura");
    expect(BILL_CLOSED.receipt).toBe(RECEIPT);
  });

  it("groups the lines by course in service order, keeping each line's data", () => {
    const groups = groupBillLines(BILL.lines);
    expect(groups.map((g) => g.course)).toEqual(["primi", "secondi", "bevande"]);
    expect(groups.map((g) => g.label)).toEqual(["Primi", "Secondi", "Bevande"]);
    expect(groups[1]!.lines.map((l) => l.id)).toEqual([BILL.lines[1]!.id, BILL.lines[2]!.id]);
  });

  it("leaves out courses with no line", () => {
    expect(groupBillLines([])).toEqual([]);
  });
});
