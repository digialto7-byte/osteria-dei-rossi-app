import { describe, expect, it } from "vitest";
import { runChecks } from "@/server/extraction/checks";
import { InvoiceExtraction } from "@/server/extraction/schema";
import { fixture } from "../../helpers/fake-anthropic-fetch";

// The two recorded responses behind tests/integration/review.int.ts. The real-stack suite cannot
// run offline, so what it relies on is pinned here: both parse with the real schema, and the
// second is the first invoice's twin with one misread quantity.
function load(name: string) {
  const message = fixture(name) as { content: { text: string }[] };
  return InvoiceExtraction.parse(JSON.parse(message.content[0]!.text));
}

describe("review fixtures", () => {
  const first = load("review-first");
  const second = load("review-second");

  it("each has ten lines: six with a supplier code, four without", () => {
    for (const data of [first, second]) {
      expect(data.lines).toHaveLength(10);
      expect(data.lines.filter((line) => line.supplier_code !== null)).toHaveLength(6);
    }
  });

  it("use only fake supplier data", () => {
    expect(first.supplier_name).toBe("Fornitore Demo Srl");
    expect(first.supplier_vat).toBe("IT12345678903");
    expect(second.supplier_vat).toBe(first.supplier_vat);
  });

  it("have the same ten articles, and the same unit for each", () => {
    const key = (data: typeof first) =>
      data.lines.map((line) => [line.supplier_code, line.description, line.unit]);
    expect(key(second)).toEqual(key(first));
  });

  it("differ in one quantity only: the misread coded line (amount no longer matches)", () => {
    const differing = first.lines.flatMap((line, index) => {
      const other = second.lines[index]!;
      return line.qty === other.qty ? [] : [{ description: line.description, was: line.qty }];
    });
    expect(differing).toEqual([{ description: "Farina 00", was: 10 }]);
    expect(runChecks(second).lineChecks.flat()).toEqual(["amount_mismatch"]);
  });

  it("pass the totals gate; a failed line check only adds the informational low_confidence flag", () => {
    expect(runChecks(first)).toMatchObject({ gateFlags: [], totalsDiff: 0 });
    expect(runChecks(first).lineChecks.flat()).toEqual([]);
    expect(runChecks(second)).toMatchObject({ gateFlags: ["low_confidence"], totalsDiff: 0 });
  });
});
