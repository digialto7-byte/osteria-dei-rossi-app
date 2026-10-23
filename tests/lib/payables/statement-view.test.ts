import { describe, expect, it } from "vitest";
import { asOfText, creditRows, isStatementEmpty, totalsRows } from "@/lib/payables/statement-view";
import { STATEMENT } from "../../components/payable-fixtures";

// Intl separates the amount and the € sign with a no-break space.
const NBSP = " ";

describe("totalsRows", () => {
  it("words the three totals in order, with the credits as a negative amount", () => {
    expect(totalsRows(STATEMENT.totals)).toEqual([
      { id: "invoices", label: "Fatture aperte", value: `1.800,00${NBSP}€` },
      { id: "credits", label: "Resi e note di credito", value: `−70,00${NBSP}€` },
      { id: "balance", label: "Saldo da pagare", value: `1.730,00${NBSP}€` },
      { id: "disputed", label: "di cui contestate", value: `280,00${NBSP}€` },
    ]);
  });

  it("leaves the disputed row out when nothing is disputed", () => {
    const rows = totalsRows({ ...STATEMENT.totals, disputedAmount: 0 });
    expect(rows.map((row) => row.id)).toEqual(["invoices", "credits", "balance"]);
  });

  it("shows the figures as the server sent them, even when they do not add up", () => {
    const rows = totalsRows({
      invoicesTotal: 100,
      creditsTotal: 10,
      balance: 5,
      disputedAmount: 0,
    });
    expect(rows.find((row) => row.id === "balance")?.value).toBe(`5,00${NBSP}€`);
  });
});

describe("creditRows", () => {
  it("words each credited invoice with its negative amount", () => {
    expect(creditRows(STATEMENT.credits)).toEqual([
      {
        id: STATEMENT.credits[0]!.payableId,
        line: "Fattura 123/A del 01/12/2026",
        amount: `−50,00${NBSP}€`,
      },
      {
        id: STATEMENT.credits[1]!.payableId,
        line: "Fattura 124 del 03/12/2026",
        amount: `−20,00${NBSP}€`,
      },
    ]);
  });
});

describe("asOfText and isStatementEmpty", () => {
  it("writes the as-of date as the venue does", () => {
    expect(asOfText("2026-10-25")).toBe("al 25/10/2026");
    expect(asOfText("2026-10-25", "en")).toBe("as of 25/10/2026");
  });
  it("a statement without invoices is empty", () => {
    expect(isStatementEmpty(STATEMENT)).toBe(false);
    expect(isStatementEmpty({ ...STATEMENT, invoices: [] })).toBe(true);
  });
});
