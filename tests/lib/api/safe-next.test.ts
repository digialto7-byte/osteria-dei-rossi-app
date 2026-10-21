import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/api/safe-next";

describe("safeNextPath", () => {
  it.each([
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["\\\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["http:/evil.example", "/"],
    ["evil.example/path", "/"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
    ["", "/"],
    [null, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("keeps a same-origin relative path with query and hash", () => {
    expect(safeNextPath("/fatture?stato=review#top")).toBe("/fatture?stato=review#top");
  });

  it("rejects control characters that browsers strip before resolving", () => {
    expect(safeNextPath("/\t/evil.example")).toBe("/");
    expect(safeNextPath("/\n/evil.example")).toBe("/");
  });
});
