import { describe, expect, it } from "vitest";

// Intl separates the amount and the € sign with a no-break space.
const NBSP = "\u00a0";
import {
  amountText,
  buildStatusBody,
  canReadPayables,
  creditText,
  dueLine,
  historyLine,
  invoiceLine,
  statusView,
  totalsLine,
} from "@/lib/payables/payable-view";
import { ITEM } from "../../components/payable-fixtures";

describe("canReadPayables", () => {
  it("is true for owner and admin only", () => {
    expect(["owner", "admin", "chef", "waiter", ""].map(canReadPayables)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("statusView", () => {
  it.each([
    ["open", "neutral", "Da pagare"],
    ["scheduled", "info", "Programmata"],
    ["paid", "success", "Pagata il 05/12/2026"],
    ["disputed", "warning", "Contestata"],
  ] as const)("%s is a %s badge saying %s", (status, tone, label) => {
    expect(statusView(status, "2026-12-05")).toEqual({ tone, label });
  });

  it("a paid status without a date still says Pagata", () => {
    expect(statusView("paid", null).label).toBe("Pagata");
  });

  it("speaks English on request", () => {
    expect(statusView("open", null, "en").label).toBe("To pay");
    expect(statusView("paid", "2026-12-05", "en").label).toBe("Paid on 05/12/2026");
  });
});

describe("dueLine", () => {
  const line = (daysToDue: number, over: Partial<typeof ITEM> = {}) =>
    dueLine({ ...ITEM, daysToDue, ...over });

  it("says how many days are left", () => {
    expect(line(7)).toBe("Scade il 10/12/2026 (tra 7 giorni)");
    expect(line(1)).toBe("Scade il 10/12/2026 (tra 1 giorno)");
  });
  it("says today", () => expect(line(0)).toBe("Scade oggi"));
  it("says how many days late", () => {
    expect(line(-3)).toBe("Scaduta da 3 giorni");
    expect(line(-1)).toBe("Scaduta da 1 giorno");
  });
  it("a paid payable shows only its due date", () => {
    expect(line(-3, { status: "paid", paidOn: "2026-12-12" })).toBe("Scadenza 10/12/2026");
  });
});

describe("invoiceLine", () => {
  it("names the number and the date", () => {
    expect(invoiceLine("123/A", "2026-12-01")).toBe("Fattura 123/A del 01/12/2026");
  });
  it("copes with a missing number or date", () => {
    expect(invoiceLine(null, "2026-12-01")).toBe("Fattura senza numero del 01/12/2026");
    expect(invoiceLine("123/A", null)).toBe("Fattura 123/A");
  });
  it("writes a date across the clock change as the venue does", () => {
    expect(invoiceLine("9", "2026-10-25")).toBe("Fattura 9 del 25/10/2026");
  });
});

describe("creditText", () => {
  it("shows a credit as a negative amount with a real minus sign", () => {
    expect(creditText(120)).toBe(`−120,00${NBSP}€`);
    expect(creditText(1234.5)).toBe(`−1.234,50${NBSP}€`);
  });
  it("shows no credit as plain zero", () => {
    expect(creditText(0)).toBe(`0,00${NBSP}€`);
  });
});

describe("amounts and totals", () => {
  it("formats euros as 1.234,50 €", () => {
    expect(amountText(1234.5)).toBe(`1.234,50${NBSP}€`);
  });
  it("words the unpaid totals with the singular and the plural", () => {
    expect(totalsLine({ count: 4, amount: 1234.5 })).toBe(`4 fatture da pagare · 1.234,50${NBSP}€`);
    expect(totalsLine({ count: 1, amount: 10 })).toBe(`1 fattura da pagare · 10,00${NBSP}€`);
  });
});

describe("historyLine", () => {
  const base = {
    reason: null,
    at: "2026-12-05T09:12:00+00:00",
    byName: "Titolare Demo",
    fromStatus: "open" as const,
  };
  it("a payment names the paid date and when it was recorded", () => {
    expect(
      historyLine({
        ...base,
        action: "payable.status_changed",
        toStatus: "paid",
        paidOn: "2026-12-05",
      }),
    ).toBe("Pagata il 05/12/2026 · registrato il 05/12/2026, 10:12 da Titolare Demo");
  });
  it("the creation entry", () => {
    expect(
      historyLine({
        ...base,
        action: "created",
        fromStatus: null,
        toStatus: "open",
        paidOn: null,
      }),
    ).toBe("Fattura approvata · registrato il 05/12/2026, 10:12 da Titolare Demo");
  });
  it("a reversal", () => {
    expect(
      historyLine({
        ...base,
        action: "payable.payment_reversed",
        fromStatus: "paid",
        toStatus: "open",
        paidOn: null,
      }),
    ).toBe("Pagamento annullato · registrato il 05/12/2026, 10:12 da Titolare Demo");
  });
  it("leaves the name out when there is none", () => {
    expect(
      historyLine({
        ...base,
        byName: null,
        action: "payable.status_changed",
        toStatus: "scheduled",
        paidOn: null,
      }),
    ).toBe("Programmata · registrato il 05/12/2026, 10:12");
  });
});

describe("buildStatusBody", () => {
  it("paid carries the date; the other statuses never do", () => {
    expect(buildStatusBody("paid", { paidOn: "2026-12-05", note: "" })).toEqual({
      status: "paid",
      paidOn: "2026-12-05",
    });
    expect(buildStatusBody("scheduled", { paidOn: "2026-12-05", note: "" })).toEqual({
      status: "scheduled",
    });
  });
  it("includes a trimmed note only when there is one", () => {
    expect(buildStatusBody("disputed", { paidOn: "", note: "  Merce rovinata " })).toEqual({
      status: "disputed",
      reason: "Merce rovinata",
    });
    expect(buildStatusBody("open", { paidOn: "", note: "   " })).toEqual({ status: "open" });
  });
});
