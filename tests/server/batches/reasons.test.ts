import { describe, expect, it } from "vitest";
import { messages } from "@/lib/i18n";
import { BATCH_WASTE_REASONS, batchReasonLabel } from "@/server/batches/reasons";
import { STOCK_REASON_CODES } from "@/server/stock/reasons";

describe("batch waste reasons (src/server/batches/reasons.ts)", () => {
  // The same literal list, in the same order, that pgTAP 130 asserts for app.batch_waste_reason_codes().
  it("are the seven codes of the database, in its order", () => {
    expect([...BATCH_WASTE_REASONS]).toEqual([
      "spoilage",
      "expired",
      "over_production",
      "plating_error",
      "staff_meal",
      "comp",
      "breakage",
    ]);
  });

  it("are the PRD stock reasons minus the count correction (a count is an adjustment)", () => {
    expect([...BATCH_WASTE_REASONS]).toEqual(
      STOCK_REASON_CODES.filter((code) => code !== "count_correction"),
    );
  });

  it("use the words of the stock catalogue, in Italian and English", () => {
    for (const code of BATCH_WASTE_REASONS) {
      expect(batchReasonLabel(code, "it")).toBe(messages.it[`stock.reason.${code}`]);
      expect(batchReasonLabel(code, "en")).toBe(messages.en[`stock.reason.${code}`]);
    }
  });
});
