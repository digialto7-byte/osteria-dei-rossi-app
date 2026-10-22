import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QualitySummary } from "@/app/(owner)/fatture/qualita/quality-summary";
import type { ExtractionQualityReport } from "@/server/reports/extraction-quality";

const report: ExtractionQualityReport = {
  invoices: 4,
  lines: 40,
  correctedLines: 4,
  correctionRate: 0.1,
  autoMappedLines: 30,
  autoMappedCorrected: 2,
  autoMappedCorrectionRate: 0.0667,
  manualMappedLines: 10,
  splitLines: 1,
  byField: {
    qty: 3,
    unit_price: 0,
    line_amount: 1,
    vat_rate: 0,
    supplier_code: 0,
    lot_code: 0,
    expiry: 0,
    unit: 0,
    ingredient: 0,
    pack: 0,
  },
  bySupplier: [
    {
      supplierId: "s1",
      name: "Fornitore Demo Srl",
      lines: 30,
      correctedLines: 2,
      correctionRate: 0.0667,
    },
    { supplierId: "s2", name: "<b>Altro</b>", lines: 10, correctedLines: 2, correctionRate: 0.2 },
  ],
};

const render = (r: ExtractionQualityReport) =>
  renderToStaticMarkup(createElement(QualitySummary, { report: r }));

describe("QualitySummary", () => {
  it("shows lines, corrected lines and the rate", () => {
    const html = render(report);
    expect(html).toMatch(/>Righe<[\s\S]*?class="num[^"]*"[^>]*>40</);
    expect(html).toMatch(/Righe corrette[\s\S]*?class="num[^"]*"[^>]*>4</);
    expect(html).toMatch(/class="num[^"]*"[^>]*>10%</);
  });

  it("shows the rate of the lines mapped from memory next to the overall one", () => {
    const html = render(report);
    expect(html).toContain("6,7%");
    expect(html).toMatch(/Righe abbinate in automatico[\s\S]*?>30</);
  });

  it("lists the corrected fields by name and the suppliers with their rate", () => {
    const html = render(report);
    expect(html).toContain("quantità");
    expect(html).toMatch(/quantità[\s\S]*?>3</);
    expect(html).toContain("Fornitore Demo Srl");
    expect(html).toContain("20%");
  });

  it("escapes a supplier name", () => {
    expect(render(report)).not.toContain("<b>Altro</b>");
  });

  it("says so when the period has no lines, and shows no figures", () => {
    const html = render({
      ...report,
      lines: 0,
      correctedLines: 0,
      correctionRate: null,
      autoMappedCorrectionRate: null,
      bySupplier: [],
    });
    expect(html).toContain("Nessuna riga nel periodo");
    expect(html).not.toContain("q-rate");
  });
});
