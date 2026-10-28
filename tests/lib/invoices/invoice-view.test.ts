import { describe, expect, it } from "vitest";
import { invoiceTitle, isInFlight } from "@/lib/invoices/invoice-view";

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
