import { describe, expect, it } from "vitest";
import { invoiceHref, invoiceTitle, isInFlight, isReviewable } from "@/lib/invoices/invoice-view";
import { INVOICE_STATUSES } from "@/server/invoices/invoices";

const base = { supplierName: null, number: null, originalFilename: null };

describe("invoiceTitle", () => {
  it("is the supplier and the number once the invoice has been read", () => {
    expect(
      invoiceTitle({
        supplierName: "Fornitore Demo Srl",
        number: "123/A",
        originalFilename: "IMG_1.jpg",
      }),
    ).toBe("Fornitore Demo Srl · 123/A");
  });

  it("is the supplier alone when the number is missing, and the number alone is not a title", () => {
    expect(
      invoiceTitle({ ...base, supplierName: "Fornitore Demo Srl", originalFilename: "a.pdf" }),
    ).toBe("Fornitore Demo Srl");
    expect(invoiceTitle({ ...base, number: "123/A", originalFilename: "a.pdf" })).toBe("a.pdf");
  });

  it("falls back to the file name, then to the untitled word", () => {
    expect(invoiceTitle({ ...base, originalFilename: "IMG_2041.jpg" })).toBe("IMG_2041.jpg");
    expect(invoiceTitle(base)).toBe("Fattura senza nome");
  });

  it("treats blank text as missing", () => {
    expect(invoiceTitle({ supplierName: "  ", number: " ", originalFilename: "a.pdf" })).toBe(
      "a.pdf",
    );
  });
});

describe("isInFlight", () => {
  it.each(["received", "extracting"] as const)("%s is still being read", (status) => {
    expect(isInFlight(status)).toBe(true);
  });
  it.each(["extraction_failed", "review", "approved", "rejected", "duplicate"] as const)(
    "%s is not",
    (status) => {
      expect(isInFlight(status)).toBe(false);
    },
  );
});

// QW10 (docs/plans/2026-11-13-ux-quick-wins.md): a row of the invoice list leads straight to the review when there is something to review.
describe("invoiceHref and isReviewable", () => {
  const ID = "1d000000-0000-4000-8000-000000000001";

  it.each(["review", "duplicate"] as const)("%s opens the review page directly", (status) => {
    expect(invoiceHref({ id: ID, status })).toBe(`/fatture/${ID}/revisione`);
    expect(isReviewable(status)).toBe(true);
  });

  it.each(["received", "extracting", "extraction_failed", "approved", "rejected"] as const)(
    "%s stays on the invoice page",
    (status) => {
      expect(invoiceHref({ id: ID, status })).toBe(`/fatture/${ID}`);
      expect(isReviewable(status)).toBe(false);
    },
  );

  it("decides for every status the API can return", () => {
    for (const status of INVOICE_STATUSES) {
      expect(invoiceHref({ id: ID, status })).toMatch(new RegExp(`^/fatture/${ID}(/revisione)?$`));
    }
  });
});
