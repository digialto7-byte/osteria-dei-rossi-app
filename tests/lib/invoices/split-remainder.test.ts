import { describe, expect, it } from "vitest";
import { splitRemainder } from "@/lib/invoices/split-remainder";

describe("splitRemainder", () => {
  it("what is left of a line after the parts entered so far", () => {
    expect(splitRemainder({ qty: 3, lineAmount: 30 }, [{ qty: 1, lineAmount: 10 }])).toEqual({
      qty: 2,
      lineAmount: 20,
    });
  });

  it("is exactly zero for 0.1 + 0.2 of 0.3, with no float noise", () => {
    expect(
      splitRemainder({ qty: 0.3, lineAmount: 0.3 }, [
        { qty: 0.1, lineAmount: 0.1 },
        { qty: 0.2, lineAmount: 0.2 },
      ]),
    ).toEqual({ qty: 0, lineAmount: 0 });
  });

  it("treats an empty field as zero and can go negative when the parts are too big", () => {
    expect(
      splitRemainder({ qty: 3, lineAmount: 30 }, [
        { qty: null, lineAmount: null },
        { qty: 4, lineAmount: 30.5 },
      ]),
    ).toEqual({ qty: -1, lineAmount: -0.5 });
  });

  it("nothing entered leaves the whole line", () => {
    expect(splitRemainder({ qty: 3, lineAmount: 30 }, [])).toEqual({ qty: 3, lineAmount: 30 });
  });
});
