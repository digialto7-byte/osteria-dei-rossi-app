import { describe, expect, it } from "vitest";
import { formatBytes } from "@/lib/format/bytes";

describe("formatBytes", () => {
  it("shows bytes, KB and MB with the locale's decimal comma", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(4_194_304)).toBe("4 MB");
    expect(formatBytes(1_572_864)).toBe("1,5 MB");
  });

  it("uses the decimal point in English", () => {
    expect(formatBytes(1_572_864, "en")).toBe("1.5 MB");
  });

  it("rejects negative or non-finite sizes", () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
    expect(() => formatBytes(Number.NaN)).toThrow(RangeError);
  });
});
