import { describe, expect, it } from "vitest";
import { runChecks } from "@/server/extraction/checks";
import { InvoiceExtraction } from "@/server/extraction/schema";
import { fixture } from "../../helpers/fake-anthropic-fetch";

// The recorded response behind tests/integration/approval.int.ts. The real-stack suite cannot run
// offline, so what it relies on is pinned here: it parses with the real schema, passes the totals
// gate and every line check, and the figures the integration test expects follow from it.
const message = fixture("approval") as { content: { text: string }[] };
const data = InvoiceExtraction.parse(JSON.parse(message.content[0]!.text));
const line = (description: string) => data.lines.find((l) => l.description === description)!;

describe("approval fixture", () => {
  it("uses only fake supplier data", () => {
    expect(data.supplier_name).toBe("Fornitore Demo Srl");
    expect(data.supplier_vat).toBe("IT12345678903");
  });

  it("is consistent: lines plus VAT equal the gross total, no line check fails", () => {
    expect(runChecks(data)).toMatchObject({ gateFlags: [], totalsDiff: 0 });
    expect(runChecks(data).lineChecks.flat()).toEqual([]);
  });

  it("has no printed due date, so the supplier's 30 days decide it", () => {
    expect(data.due_date).toBeNull();
    expect(data.invoice_date).toBe("2026-09-29");
  });

  it("has the six lines the scenario needs: a pack, grams, a split, non-stock and a credit", () => {
    expect(data.lines).toHaveLength(6);
    expect(line("Passata di pomodoro")).toMatchObject({ qty: 2, unit: "CT", line_amount: 30 });
    expect(line("Zafferano in polvere")).toMatchObject({ qty: 500, unit: "g", line_amount: 4 });
    expect(line("Parmigiano Reggiano 24 mesi")).toMatchObject({ qty: 3, line_amount: 30 });
    expect(line("Detersivo piatti")).toMatchObject({ vat_rate: 22 });
    expect(line("Burro")).toMatchObject({ qty: 2, line_amount: 20, vat_rate: 10 });
  });
});
