import { describe, expect, it } from "vitest";
import {
  blockerText,
  canApproveNow,
  confirmText,
  creditText,
  decisionText,
  payableText,
  receiptsText,
  receiveBadge,
  visibleBlockers,
} from "@/lib/invoices/approval-view";
import { lineBadges } from "@/lib/invoices/review-view";
import { isMessageKey, messages } from "@/lib/i18n";
import type { ApprovalInfo, PayableFigures } from "@/server/invoices/review-types";
import { makeLine } from "../../helpers/review-line";

// formatEuro writes a no-break space before the euro sign; expectations are written with a plain one.
const nb = (text: string) => text.replaceAll(" €", "\u00a0€");

const payable = (over: Partial<PayableFigures> = {}): PayableFigures => ({
  grossAmount: 1240,
  creditedAmount: 5.5,
  amount: 1234.5,
  dueDate: "2026-10-29",
  dueDateSource: "supplier_terms",
  ...over,
});

const approval = (over: Partial<ApprovalInfo> = {}): ApprovalInfo => ({
  canApprove: true,
  blockers: [],
  receiptDate: "2026-09-29",
  payable: payable(),
  receipts: 6,
  locations: { required: false, options: [{ id: "l1", name: "Cella" }], defaultId: "l1" },
  ...over,
});

const CODES = [
  "total_mismatch",
  "duplicate_invoice",
  "duplicate_warning",
  "supplier_required",
  "invoice_date_required",
  "invoice_date_in_future",
  "due_date_required",
  "lines_unmapped",
  "line_base_qty_unavailable",
  "credit_vat_rate_missing",
  "payable_negative",
  "no_location",
  "location_required",
  "location_not_found",
  "invoice_already_approved",
  "invoice_rejected",
];

describe("payableText", () => {
  it("writes the amount, the due date and where the date came from", () => {
    expect(payableText(payable())).toBe(
      nb("Da pagare 1.234,50 € entro il 29/10/2026 · dai termini del fornitore"),
    );
  });

  it("says 'dalla fattura' when the invoice printed the due date", () => {
    expect(payableText(payable({ dueDateSource: "invoice" }))).toBe(
      nb("Da pagare 1.234,50 € entro il 29/10/2026 · dalla fattura"),
    );
  });

  it("leaves out what the server could not work out yet", () => {
    expect(payableText(payable({ dueDate: null, dueDateSource: null }))).toBe(
      nb("Da pagare 1.234,50 €"),
    );
    expect(payableText(payable({ amount: null }))).toBeNull();
  });

  it("has an English second locale", () => {
    expect(payableText(payable(), "en")).toBe(
      "To pay €1,234.50 by 29/10/2026 · from the supplier's terms",
    );
  });
});

describe("creditText", () => {
  it("shows the gross total less the credited value, only when something is credited", () => {
    expect(creditText(payable())).toBe(nb("Totale fattura 1.240,00 € meno resi 5,50 €"));
    expect(creditText(payable({ creditedAmount: 0 }))).toBeNull();
    expect(creditText(payable({ grossAmount: null }))).toBeNull();
  });
});

describe("receiptsText", () => {
  it("writes the receipt date and how many receipts will be booked", () => {
    expect(receiptsText(approval())).toBe("Carico del 29/09/2026 · 6 carichi");
  });

  it("uses the singular and names the only location", () => {
    expect(receiptsText(approval({ receipts: 1 }), "Cella")).toBe(
      "Carico del 29/09/2026 · 1 carico in Cella",
    );
  });

  it("copes with no receipt date yet", () => {
    expect(receiptsText(approval({ receiptDate: null }))).toBe("6 carichi");
  });
});

describe("confirmText", () => {
  it("states what will be booked and that it cannot be undone", () => {
    expect(confirmText(approval())).toBe(
      nb("Registra 6 carichi e un debito di 1.234,50 €. Non si può annullare."),
    );
    expect(confirmText(approval({ receipts: 1 }))).toContain("Registra 1 carico e");
  });

  it("in English too", () => {
    expect(confirmText(approval(), "en")).toBe(
      "Books 6 receipts and a payable of €1,234.50. This cannot be undone.",
    );
  });
});

describe("blockerText", () => {
  it("every code the server can send has a sentence in both languages", () => {
    for (const code of CODES) {
      const text = blockerText({ code, lineIds: [] });
      expect(text, code).not.toBe("");
      expect(text, code).not.toMatch(/[{}]/);
      expect(blockerText({ code, lineIds: [] }, "en"), code).not.toMatch(/[{}]/);
    }
  });

  it("uses the plan's sentences", () => {
    expect(blockerText({ code: "total_mismatch", lineIds: [] })).toBe(
      "Il totale non corrisponde: correggi le righe o l'intestazione.",
    );
    expect(blockerText({ code: "supplier_required", lineIds: [] })).toBe("Collega il fornitore.");
    expect(blockerText({ code: "location_required", lineIds: [] })).toBe(
      "Scegli l'ubicazione del carico.",
    );
    expect(blockerText({ code: "credit_vat_rate_missing", lineIds: ["a"] })).toBe(
      "Una riga con reso non ha l'aliquota IVA.",
    );
  });

  it("counts the lines from the line ids, in the singular and the plural", () => {
    expect(blockerText({ code: "lines_unmapped", lineIds: ["a"] })).toBe("1 riga da abbinare.");
    expect(blockerText({ code: "lines_unmapped", lineIds: ["a", "b", "c"] })).toBe(
      "3 righe da abbinare.",
    );
    expect(blockerText({ code: "line_base_qty_unavailable", lineIds: ["a", "b"] })).toBe(
      "2 righe senza unità o confezione valida.",
    );
    expect(blockerText({ code: "line_base_qty_unavailable", lineIds: ["a"] })).toBe(
      "1 riga senza unità o confezione valida.",
    );
  });

  it("a code the screen does not know still reads as a sentence, never as a raw code", () => {
    expect(blockerText({ code: "something_new", lineIds: [] })).toBe(
      "Controlla la fattura prima di approvarla.",
    );
  });

  it("keys exist for every code in both catalogues", () => {
    for (const code of CODES) {
      const key = `approval.blocker.${code}`;
      const present = isMessageKey(key) || isMessageKey(`${key}.one`);
      expect(present, code).toBe(true);
    }
    expect(Object.keys(messages.en).filter((k) => k.startsWith("approval."))).toEqual(
      Object.keys(messages.it).filter((k) => k.startsWith("approval.")),
    );
  });
});

describe("visibleBlockers and canApproveNow", () => {
  const needsLocation = approval({
    canApprove: false,
    blockers: [{ code: "location_required", lineIds: [] }],
    locations: {
      required: true,
      options: [
        { id: "l1", name: "Cella" },
        { id: "l2", name: "Dispensa" },
      ],
      defaultId: null,
    },
  });

  it("with several locations and none chosen, 'Scegli l'ubicazione' stays and blocks", () => {
    expect(visibleBlockers(needsLocation, "").map((b) => b.code)).toEqual(["location_required"]);
    expect(canApproveNow(needsLocation, "")).toBe(false);
  });

  it("choosing a location answers location_required: approval opens", () => {
    expect(visibleBlockers(needsLocation, "l2")).toEqual([]);
    expect(canApproveNow(needsLocation, "l2")).toBe(true);
  });

  it("choosing a location never hides another blocker", () => {
    const both = approval({
      ...needsLocation,
      blockers: [
        { code: "lines_unmapped", lineIds: ["a"] },
        { code: "location_required", lineIds: [] },
      ],
    });
    expect(visibleBlockers(both, "l1").map((b) => b.code)).toEqual(["lines_unmapped"]);
    expect(canApproveNow(both, "l1")).toBe(false);
  });

  it("the server's verdict stands when there is no location question", () => {
    expect(canApproveNow(approval(), "")).toBe(true);
    const blocked = approval({
      canApprove: false,
      blockers: [{ code: "total_mismatch", lineIds: [] }],
    });
    expect(canApproveNow(blocked, "")).toBe(false);
  });
});

describe("decisionText (Europe/Rome)", () => {
  const decided = (at: string, byName: string | null = "Titolare Demo") =>
    decisionText({ action: "approved", at, byName, reason: null });

  it("writes the venue time and the person", () => {
    expect(decided("2026-10-22T08:12:00+00:00")).toBe("il 22/10/2026, 10:12 da Titolare Demo");
  });

  it("DST ends on 25/10/2026: 00:30Z is summer time, 01:30Z is winter time, both 02:30", () => {
    expect(decided("2026-10-25T00:30:00Z", null)).toBe("il 25/10/2026, 02:30");
    expect(decided("2026-10-25T01:30:00Z", null)).toBe("il 25/10/2026, 02:30");
  });

  it("DST starts on 28/03/2027: 01:30Z is 03:30", () => {
    expect(decided("2027-03-28T01:30:00Z", null)).toBe("il 28/03/2027, 03:30");
  });

  it("leaves out a name the server did not send, and survives a bad date", () => {
    expect(decided("2026-10-22T08:12:00Z", null)).toBe("il 22/10/2026, 10:12");
    expect(decided("not a date")).toBe("da Titolare Demo");
  });
});

describe("receiveBadge and the line badges", () => {
  it("'Da caricare: 12 kg' on a line that will be received", () => {
    const line = makeLine({ toReceive: { qty: 12, unit: "kg", unitPrice: 2.5 } });
    expect(receiveBadge(line)).toMatchObject({ id: "to-receive", text: "Da caricare: 12 kg" });
    expect(lineBadges(line).map((b) => b.id)).toContain("to-receive");
  });

  it("'Caricato: 12 kg' once approved, with a success tone", () => {
    const line = makeLine({ received: { qty: 12, unit: "kg" } });
    expect(receiveBadge(line)).toMatchObject({
      id: "received",
      tone: "success",
      text: "Caricato: 12 kg",
    });
  });

  it("no badge for a line that posts nothing", () => {
    expect(receiveBadge(makeLine())).toBeNull();
    expect(lineBadges(makeLine()).map((b) => b.id)).not.toContain("to-receive");
  });
});
