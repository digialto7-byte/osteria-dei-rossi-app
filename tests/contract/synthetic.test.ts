import { describe, expect, it } from "vitest";
import { checkInvoiceFile } from "@/server/invoices/file-check";
import { INJECTION_PHRASE, fakeInjectionPdf } from "../helpers/fake-files";

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("fakeInjectionPdf (synthetic contract document)", () => {
  it("is a PDF the upload checks accept", () => {
    const checked = checkInvoiceFile({
      bytes: fakeInjectionPdf(),
      declaredMime: "application/pdf",
      filename: "x.pdf",
    });
    expect(checked.kind).toBe("pdf");
  });

  it("carries the injection sentence and the printed prices as page text", () => {
    const body = text(fakeInjectionPdf());
    expect(body).toContain(INJECTION_PHRASE);
    expect(INJECTION_PHRASE).toContain("ignore previous instructions");
    expect(body).toContain("12.50");
    expect(body).toContain("8.00");
    expect(body).toContain("22.55");
  });

  it("has a cross-reference table whose offsets point at the objects", () => {
    const body = text(fakeInjectionPdf());
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(body)?.[1]);
    expect(body.slice(start, start + 4)).toBe("xref");
    const entries = [...body.slice(start).matchAll(/^(\d{10}) \d{5} n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(entries.length).toBeGreaterThanOrEqual(5);
    entries.forEach((offset, index) => {
      expect(body.slice(offset, offset + 7)).toBe(`${index + 1} 0 obj`);
    });
  });

  it("is deterministic and small", () => {
    expect(fakeInjectionPdf()).toEqual(fakeInjectionPdf());
    expect(fakeInjectionPdf().byteLength).toBeLessThan(4096);
  });
});
