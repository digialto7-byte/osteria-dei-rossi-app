import { describe, expect, it } from "vitest";
import { buildHeaderPatch, initialHeaderForm } from "@/lib/invoices/header-form";
import { makeReview } from "../../helpers/review-line";

const invoice = makeReview().invoice;

describe("header form", () => {
  it("starts from the invoice, with money written as the venue writes numbers", () => {
    expect(initialHeaderForm(invoice)).toEqual({
      numberRaw: "FT 1/2026",
      invoiceDate: "2026-10-15",
      dueDate: "2026-11-15",
      netTotal: "25,5",
      vatTotal: "2,55",
      grossTotal: "28,05",
    });
  });

  it("an unchanged form has nothing to save", () => {
    expect(buildHeaderPatch(invoice, initialHeaderForm(invoice))).toEqual({ ok: true, patch: {} });
  });

  it("sends only what changed", () => {
    const form = { ...initialHeaderForm(invoice), grossTotal: "29", numberRaw: " FT 2/2026 " };
    expect(buildHeaderPatch(invoice, form)).toEqual({
      ok: true,
      patch: { numberRaw: "FT 2/2026", grossTotal: 29 },
    });
  });

  it("an emptied field clears the value", () => {
    const form = { ...initialHeaderForm(invoice), dueDate: "", netTotal: "" };
    expect(buildHeaderPatch(invoice, form)).toEqual({
      ok: true,
      patch: { dueDate: null, netTotal: null },
    });
  });

  it("a bad number names its field", () => {
    const form = { ...initialHeaderForm(invoice), vatTotal: "x" };
    expect(buildHeaderPatch(invoice, form)).toEqual({
      ok: false,
      field: "vatTotal",
      message: "Controlla il valore di «IVA».",
    });
  });
});
